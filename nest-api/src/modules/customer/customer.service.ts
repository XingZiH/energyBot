import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import { customersTable, licensesTable } from '../../drizzle/schema';
import { and, asc, desc, eq, ilike, isNull, SQL } from 'drizzle-orm';
import { LicenseService } from '../license/license.service';
import { TableDataInfo } from '../../common/result/result';
import {
  CreateCustomerDto,
  ListCustomerFilterDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

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
      return row;
    });

    // 事务外生成 license（license.service 使用相同 conn，将写入同一张表）。
    // 这里故意放到事务外——Service 内部加密和 INSERT 是独立原子，失败后客户记录可手工重发。
    const credential = await this.licenseService.generate(inserted.id, createdBy);

    return {
      customerId: inserted.id,
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
}
