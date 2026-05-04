import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import { userTable } from '../../drizzle/schema';
import { AgentService } from './agent.service';

/**
 * 「我的 Bot」视图模型：当前登录用户所绑定客户下的一台 agent 主机信息。
 *
 * 字段选型（见任务 9 D4）：
 * - Date 字段统一转 ISO string 或 null（前端直接用 Date 构造器消费）
 * - customerId / deletedAt 不暴露：前端已知自己是哪个客户，且内部字段不对外
 * - cpuPercent / loadavg1 是 drizzle numeric → string，由前端自行 parseFloat
 * - licenseId 暴露，便于前端与 license 列表 join
 */
export interface MyBotAgentView {
  id: number;
  licenseId: number;
  status: string; // 'online' | 'offline' | 'never_seen'
  agentVersion: string | null;
  publicIp: string | null;
  hostName: string | null;
  kernel: string | null;
  bootTime: string | null; // ISO
  connectedAt: string | null; // ISO
  lastHeartbeatAt: string | null; // ISO
  uptimeSeconds: number | null;
  cpuPercent: string | null; // drizzle numeric → string
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  loadavg1: string | null; // numeric → string
  createdAt: string | null; // ISO
  updatedAt: string | null; // ISO
}

/**
 * 终端客户「我的 Bot」查询服务。
 *
 * 安全模型：
 * - 入参永远是 JWT 里的 userId（由 controller 从 req.user.userId 取出），禁止接受外部 customerId
 * - 从 user.customer_id 反查客户，customer_id 为 NULL（管理员/内部操作员）抛 NotFound
 *   文案「当前账号未绑定客户」与 MyLicenseService 保持一致，前端兜底展示统一
 * - userId 查不到时抛 NotFoundException（任务 9 规格要求，与 MyLicenseService 用
 *   UnauthorizedException 的风格不一致——见文件末尾技术债注释）
 */
@Injectable()
export class MyBotService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
    private readonly agents: AgentService,
  ) {}

  /**
   * 按登录用户 id 查询其绑定客户下的所有 agents。
   *
   * @throws NotFoundException 用户不存在 / 当前账号未绑定客户
   */
  async findByUserId(userId: number): Promise<MyBotAgentView[]> {
    const rows = await this.conn
      .select({
        userId: userTable.id,
        customerId: userTable.customerId,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('用户不存在');
    }
    const customerId = rows[0].customerId;
    if (customerId === null || customerId === undefined) {
      // 明确告知前端：此账号未绑定客户；前端已有针对此句的兜底提示
      throw new NotFoundException('当前账号未绑定客户');
    }

    // 该 customer 下无 agents → 返回空数组（而非 404），区别于 admin 误入
    const agents = await this.agents.listForCustomer(customerId);
    return agents.map((a) => this.toView(a));
  }

  /**
   * drizzle 行 → 对外 view 的转换。
   *
   * `a` 用 any 而非 drizzle 推导类型：drizzle 的 select() 行类型在 spec mock 场景下
   * 会和运行时推导合不上（spec 走手工 plain object），为保证实现/测试统一用 any，
   * 字段对齐靠 MyBotAgentView 的返回类型检查兜底。属于可接受的技术债。
   */
  private toView(a: any): MyBotAgentView {
    return {
      id: a.id,
      licenseId: a.licenseId,
      status: a.status,
      agentVersion: a.agentVersion,
      publicIp: a.publicIp,
      hostName: a.hostName,
      kernel: a.kernel,
      bootTime: a.bootTime?.toISOString() ?? null,
      connectedAt: a.connectedAt?.toISOString() ?? null,
      lastHeartbeatAt: a.lastHeartbeatAt?.toISOString() ?? null,
      uptimeSeconds: a.uptimeSeconds,
      cpuPercent: a.cpuPercent,
      memUsedBytes: a.memUsedBytes,
      memTotalBytes: a.memTotalBytes,
      loadavg1: a.loadavg1,
      createdAt: a.createdAt?.toISOString() ?? null,
      updatedAt: a.updatedAt?.toISOString() ?? null,
    };
  }
}
