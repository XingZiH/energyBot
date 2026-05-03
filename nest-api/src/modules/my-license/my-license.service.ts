import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import { customersTable, licensesTable, userTable } from '../../drizzle/schema';
import { LicenseService } from '../license/license.service';

/**
 * "我的 License" 视图模型：当前登录用户所绑定客户的 license 概况。
 * 用于终端客户自助查看自己的 license 状态，不涉及别的客户。
 */
export interface MyLicenseView {
  customerId: number;
  customerName: string;
  customerStatus: 'active' | 'suspended';
  licenseKey: string | null; // 没有现役 license 时为 null
  licenseStatus: 'active' | 'revoked' | 'none';
  issuedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

/**
 * 普通用户「我的 License」查询服务。
 *
 * 安全模型：
 * - 入参永远是 JWT 里的 userId（由 controller 从 req.user.userId 取出），禁止接受任何外部传入的 customerId
 * - 从 user.customer_id 反查客户，customer_id 为 NULL 的用户（管理员 / 内部操作员）应收到 404
 *   而不是看到"别人"的数据
 * - install 命令 / licenseSecret 解密委托给 LicenseService，由它集中处理加密密钥
 */
@Injectable()
export class MyLicenseService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
    private readonly licenseService: LicenseService,
  ) {}

  /**
   * 根据登录用户 id 反查其绑定客户的 license 概况。
   *
   * @throws UnauthorizedException 用户不存在或已删除
   * @throws NotFoundException     该登录账号未绑定任何客户（管理员 / 内部操作员走错入口）
   */
  async findByUserId(userId: number): Promise<MyLicenseView> {
    const rows = await this.conn
      .select({
        userId: userTable.id,
        customerId: userTable.customerId,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (rows.length === 0) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const customerId = rows[0].customerId;
    if (customerId === null || customerId === undefined) {
      // 明确告知前端：此账号未绑定客户，前端可展示"此账号不是客户账号"空状态
      throw new NotFoundException('当前账号未绑定客户');
    }

    const [customer] = await this.conn
      .select({
        id: customersTable.id,
        name: customersTable.name,
        status: customersTable.status,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.id, customerId),
          isNull(customersTable.deletedAt),
        ),
      )
      .limit(1);
    if (!customer) {
      // 客户被管理员软删但 user 未解绑 —— 数据状态异常但不应泄漏他人数据
      throw new NotFoundException('客户档案已被删除，请联系管理员');
    }

    // 取最新一条 license（无论是否吊销）用于展示状态。
    const [latest] = await this.conn
      .select({
        licenseKey: licensesTable.licenseKey,
        issuedAt: licensesTable.issuedAt,
        revokedAt: licensesTable.revokedAt,
        revokedReason: licensesTable.revokedReason,
        lastSeenAt: licensesTable.lastSeenAt,
      })
      .from(licensesTable)
      .where(eq(licensesTable.customerId, customerId))
      .orderBy(desc(licensesTable.id))
      .limit(1);

    if (!latest) {
      return {
        customerId: customer.id,
        customerName: customer.name,
        customerStatus: customer.status as 'active' | 'suspended',
        licenseKey: null,
        licenseStatus: 'none',
        issuedAt: null,
        lastSeenAt: null,
        revokedAt: null,
        revokedReason: null,
      };
    }

    return {
      customerId: customer.id,
      customerName: customer.name,
      customerStatus: customer.status as 'active' | 'suspended',
      licenseKey: latest.licenseKey,
      licenseStatus: latest.revokedAt ? 'revoked' : 'active',
      issuedAt: latest.issuedAt?.toISOString() ?? null,
      lastSeenAt: latest.lastSeenAt?.toISOString() ?? null,
      revokedAt: latest.revokedAt?.toISOString() ?? null,
      revokedReason: latest.revokedReason,
    };
  }

  /**
   * 查看自己的当前 license 的 install 命令（含 secret 明文）。
   *
   * 校验链：userId → customerId → LicenseService.getInstallCommand(customerId)
   * 这意味着即使管理员偷偷改了用户的 customerId，看到的也只能是它现在指向的那个客户的命令，
   * 不会绕过。
   */
  async getInstallCommand(userId: number): Promise<string> {
    const rows = await this.conn
      .select({ customerId: userTable.customerId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (rows.length === 0) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    const customerId = rows[0].customerId;
    if (customerId === null || customerId === undefined) {
      throw new NotFoundException('当前账号未绑定客户');
    }
    const cmd = await this.licenseService.getInstallCommand(customerId);
    if (!cmd) {
      throw new NotFoundException('当前无可用 license，请联系管理员颁发');
    }
    return cmd;
  }
}
