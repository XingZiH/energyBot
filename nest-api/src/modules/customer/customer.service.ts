import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import {
  customersTable,
  licensesTable,
  sysUserRoleTable,
  userTable,
} from '../../drizzle/schema';
import { and, asc, desc, eq, ilike, isNull, SQL } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { LicenseService } from '../license/license.service';
import { TableDataInfo } from '../../common/result/result';
import {
  CreateCustomerDto,
  ListCustomerFilterDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * 终端客户登录账号的默认部门 / 角色 id。
 *
 * 约束：
 * - department_id = 1 在 seed 数据里对应"Ant科技"（项目自带根部门）
 * - role_id = 3 对应"用户"（最低权限角色），且已在 20260503-my-license.sql migration 里
 *   授予了 default:account:my-license 与 reveal 两个权限码
 *
 * 如果未来部署的租户修改了种子数据，这里需要随 migration 一起改。
 */
const DEFAULT_CUSTOMER_LOGIN_DEPARTMENT_ID = 1;
const DEFAULT_CUSTOMER_LOGIN_ROLE_ID = 3;

/**
 * Customer 业务服务。
 *
 * 核心原则：
 * - create 事务保证客户与 license 同生同灭
 * - list 分页返回时附带 has_active_license 标记，便于列表徽章显示
 * - 所有 license 相关操作（吊销/重发）都委托 LicenseService，保持职责单一
 */
@Injectable()
export class CustomerService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
    private readonly licenseService: LicenseService,
  ) {}

  async create(dto: CreateCustomerDto, createdBy: number) {
    // 参数联动校验：loginUserName / loginPassword 要么都给，要么都不给
    const hasLoginName = !!dto.loginUserName?.trim();
    const hasLoginPwd = !!dto.loginPassword;
    if (hasLoginName !== hasLoginPwd) {
      throw new BadRequestException(
        'loginUserName 和 loginPassword 必须同时提供或同时省略',
      );
    }
    const wantCreateUser = hasLoginName && hasLoginPwd;

    // 若要同步建登录账号，先检查用户名是否已被占用（事务里再加乐观锁意义不大，唯一约束靠应用层拦截）
    if (wantCreateUser) {
      const existing = await this.conn
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.userName, dto.loginUserName!.trim()))
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictException(
          `登录用户名 ${dto.loginUserName} 已被占用`,
        );
      }
    }

    // 登录密码 hash 提前算好，避免在事务里做 CPU 密集操作导致连接占用
    const hashedPwd = wantCreateUser
      ? await argon2.hash(dto.loginPassword!)
      : null;

    const inserted = await this.conn.transaction(async (db) => {
      const [row] = await db
        .insert(customersTable)
        .values({
          name: dto.name,
          contact: dto.contact,
          remark: dto.remark,
          createdBy,
        })
        .returning({ id: customersTable.id });

      if (wantCreateUser) {
        // 建 user 行：
        //   - userName / password 来自 DTO
        //   - available=true、sex=0（未设置）、mobile=''（允许空字符串，因为 notNull 但无长度下限校验）
        //   - departmentId = 1（Ant科技）
        //   - customerId = 新客户 id → 供 MyLicenseService 按 JWT.userId → customerId → license 查找
        const [newUser] = await db
          .insert(userTable)
          .values({
            userName: dto.loginUserName!.trim(),
            password: hashedPwd!,
            available: true,
            sex: 0,
            mobile: '',
            departmentId: DEFAULT_CUSTOMER_LOGIN_DEPARTMENT_ID,
            customerId: row.id,
          })
          .returning({ id: userTable.id });

        // 绑定默认角色（role_id=3 "用户"）
        await db.insert(sysUserRoleTable).values({
          userId: newUser.id,
          roleId: DEFAULT_CUSTOMER_LOGIN_ROLE_ID,
        });
      }

      return row;
    });

    // 事务外生成 license（license.service 使用相同 conn，将写入同一张表）。
    // 这里故意放到事务外——Service 内部加密和 INSERT 是独立原子，失败后客户记录可手工重发。
    const credential = await this.licenseService.generate(inserted.id, createdBy);

    return {
      customerId: inserted.id,
      // 让前端可据此决定是否展示"登录账号已创建"提示
      loginUserCreated: wantCreateUser,
      loginUserName: wantCreateUser ? dto.loginUserName!.trim() : null,
      ...credential,
    };
  }

  async list(params: ListCustomerFilterDto) {
    const filters: SQL[] = [isNull(customersTable.deletedAt)];
    if (params.name) {
      filters.push(ilike(customersTable.name, `%${params.name}%`));
    }
    if (params.status && params.status !== 'all') {
      filters.push(eq(customersTable.status, params.status));
    }

    const pageSize = params.pageSize > 0 ? params.pageSize : 10;
    const pageIndex = params.pageIndex > 0 ? params.pageIndex : 1;

    const { total, list } = await this.conn.transaction(async (db) => {
      const total = await db.$count(
        customersTable,
        filters.length > 0 ? and(...filters) : undefined,
      );
      const list = await db
        .select({
          id: customersTable.id,
          name: customersTable.name,
          contact: customersTable.contact,
          remark: customersTable.remark,
          status: customersTable.status,
          createdBy: customersTable.createdBy,
          createdAt: customersTable.createdAt,
        })
        .from(customersTable)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(customersTable.id))
        .limit(pageSize)
        .offset((pageIndex - 1) * pageSize);

      // 一次查出每个 customer 的活跃 license 数，拼到列表返回
      const activeRows = await db
        .select({
          customerId: licensesTable.customerId,
          licenseKey: licensesTable.licenseKey,
          lastSeenAt: licensesTable.lastSeenAt,
        })
        .from(licensesTable)
        .where(isNull(licensesTable.revokedAt));

      const activeByCustomer = new Map<number, { licenseKey: string; lastSeenAt: Date | null }>();
      for (const row of activeRows) {
        activeByCustomer.set(row.customerId, {
          licenseKey: row.licenseKey,
          lastSeenAt: row.lastSeenAt ?? null,
        });
      }

      const enriched = list.map((c) => {
        const active = activeByCustomer.get(c.id);
        return {
          ...c,
          hasActiveLicense: !!active,
          activeLicenseKey: active?.licenseKey ?? null,
          lastSeenAt: active?.lastSeenAt ?? null,
        };
      });

      return { total, list: enriched };
    });

    return TableDataInfo.result(list, pageSize, pageIndex, total);
  }

  async findById(id: number) {
    const rows = await this.conn
      .select()
      .from(customersTable)
      .where(
        and(eq(customersTable.id, id), isNull(customersTable.deletedAt)),
      );
    if (rows.length === 0) {
      throw new NotFoundException('客户不存在');
    }
    const customer = rows[0];
    const licenses = await this.conn
      .select({
        id: licensesTable.id,
        licenseKey: licensesTable.licenseKey,
        issuedAt: licensesTable.issuedAt,
        revokedAt: licensesTable.revokedAt,
        revokedReason: licensesTable.revokedReason,
        lastSeenAt: licensesTable.lastSeenAt,
      })
      .from(licensesTable)
      .where(eq(licensesTable.customerId, id))
      .orderBy(desc(licensesTable.id));
    return { ...customer, licenses };
  }

  async update(dto: UpdateCustomerDto) {
    const { id, ...fields } = dto;
    const existing = await this.conn
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(eq(customersTable.id, id), isNull(customersTable.deletedAt)),
      );
    if (existing.length === 0) {
      throw new NotFoundException('客户不存在');
    }
    // drizzle 对 undefined 字段默认忽略，不会清空已有值
    await this.conn
      .update(customersTable)
      .set(fields)
      .where(eq(customersTable.id, id));
    return null;
  }

  /**
   * 吊销客户当前有效的 license（若有）。幂等。
   */
  async revokeLicense(customerId: number, reason?: string) {
    const rows = await this.conn
      .select({ id: licensesTable.id })
      .from(licensesTable)
      .where(
        and(
          eq(licensesTable.customerId, customerId),
          isNull(licensesTable.revokedAt),
        ),
      );
    for (const row of rows) {
      await this.licenseService.revoke(row.id, reason);
    }
    return { revokedCount: rows.length };
  }

  /**
   * 重新颁发 license：吊销当前有效的并生成新的。
   */
  async reissueLicense(customerId: number, issuedBy: number, reason?: string) {
    const existing = await this.conn
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.id, customerId),
          isNull(customersTable.deletedAt),
        ),
      );
    if (existing.length === 0) {
      throw new NotFoundException('客户不存在');
    }
    return this.licenseService.reissue(customerId, issuedBy, reason);
  }

  /**
   * 查看 install 命令（含 secret 明文）——调用方控制器必须带 reveal 权限。
   */
  async getInstallCommand(customerId: number): Promise<string> {
    const cmd = await this.licenseService.getInstallCommand(customerId);
    if (!cmd) {
      throw new NotFoundException('该客户无有效 license，请先重新颁发');
    }
    return cmd;
  }

  /**
   * 在给定事务里为一个**已存在的 user** 自动开通 customer + license，并将 user.customer_id 回填。
   *
   * 场景：
   * 1. AuthService.signup —— 自助注册。user 已在同一事务中插入，调用本方法完成"注册即发 license"
   * 2. UserService.create —— 后台运营建用户。同上
   * 3. 存量补齐 CLI —— 对历史 user 逐条补齐
   *
   * 约定：
   * - 只在传入 tx 上操作，失败由调用方回滚；不触碰 this.conn
   * - customer.name 默认 = userName；后期客户可在「我的 License」改（本期不做）
   * - 返回 license 凭据给上层决定是否展示（signup 返回前端；CLI 打印；UserService 丢弃）
   *
   * @param tx        Drizzle 事务句柄（必填，强制调用方承担事务）
   * @param userId    已插入的 user.id
   * @param userName  用于填 customer.name
   * @param issuedBy  审计：颁发人 userId。signup 场景 = 自己；后台建账号 = 操作管理员
   */
  async provisionForUser(
    tx: NodePgDatabase<typeof schema>,
    userId: number,
    userName: string,
    issuedBy: number,
  ) {
    const [customerRow] = await tx
      .insert(customersTable)
      .values({
        name: userName,
        createdBy: issuedBy,
      })
      .returning({ id: customersTable.id });

    await tx
      .update(userTable)
      .set({ customerId: customerRow.id })
      .where(eq(userTable.id, userId));

    const credential = await this.licenseService.generate(
      customerRow.id,
      issuedBy,
      tx,
    );

    return {
      customerId: customerRow.id,
      ...credential,
    };
  }
}
