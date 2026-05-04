import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, lt } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import { agentsTable } from '../../drizzle/schema';

/**
 * Agent 主机心跳 metrics（由 WSS 心跳包带上来）。
 * cpuPercent / loadavg1 落库前会 toFixed(2) 转成 string（drizzle numeric）。
 */
export interface HeartbeatMetrics {
  uptimeSeconds: number;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  loadavg1: number;
}

/**
 * AgentService —— agents 表的 DB 层。
 *
 * 职责：
 * - WSS 握手成功后 upsert 行为 online
 * - 心跳 20s 去抖写入 last_heartbeat_at + 主机 metrics
 * - 连接断开时置 offline
 * - OfflineScheduler 定期调 markStaleAsOffline 批量置离线
 * - GET /agent/my-bot 读 listForCustomer
 */
@Injectable()
export class AgentService {
  /** 心跳写 DB 去抖窗口：20s 内多次心跳只写一次 */
  static readonly HEARTBEAT_DEBOUNCE_MS = 20_000;

  /** 进程内去抖 map：licenseId → 上次落盘的毫秒时间戳。断开时需 delete 条目。 */
  private readonly lastHbWriteAt = new Map<number, number>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * 握手成功时调用：原子 upsert（INSERT ... ON CONFLICT (license_id) DO UPDATE ...）。
   *
   * 为什么用 onConflictDoUpdate 而不是 select-then-branch：
   *   1. 消除 TOCTOU——同 licenseId 并发握手不会再触发 UNIQUE 冲突 500
   *   2. 仓库既有先例（ui-config.service.ts:255-262），风格一致
   *
   * UPDATE 分支显式把 5 个 metrics 字段置 null：
   *   旧值是上次下线前的快照（最多陈旧 30s 直到下一次心跳）；
   *   清零让 GET /agent/my-bot 立即展示"online 但 metrics 待上报"而不是过期数据。
   */
  async upsertOnline(params: {
    licenseId: number;
    customerId: number;
    agentVersion: string;
    publicIp: string;
    hostName: string;
    kernel: string;
    bootTime: Date;
  }): Promise<void> {
    const now = new Date();
    const { licenseId, customerId, agentVersion, publicIp, hostName, kernel, bootTime } = params;

    await this.conn
      .insert(agentsTable)
      .values({
        licenseId,
        customerId,
        status: 'online',
        agentVersion,
        publicIp,
        hostName,
        kernel,
        bootTime,
        connectedAt: now,
        lastHeartbeatAt: now,
      })
      .onConflictDoUpdate({
        target: agentsTable.licenseId,
        set: {
          status: 'online',
          agentVersion,
          publicIp,
          hostName,
          kernel,
          bootTime,
          connectedAt: now,
          lastHeartbeatAt: now,
          updatedAt: now,
          // 重连清零旧 metrics，等下一次心跳刷新
          uptimeSeconds: null,
          cpuPercent: null,
          memUsedBytes: null,
          memTotalBytes: null,
          loadavg1: null,
        },
      });
  }

  /** 心跳到达：20s 去抖；窗口内直接丢弃不写 DB。 */
  async updateHeartbeat(licenseId: number, m: HeartbeatMetrics): Promise<void> {
    const now = Date.now();
    const last = this.lastHbWriteAt.get(licenseId) ?? 0;
    if (now - last < AgentService.HEARTBEAT_DEBOUNCE_MS) return;
    this.lastHbWriteAt.set(licenseId, now);
    await this.writeHeartbeatToDb(licenseId, m);
  }

  /** 真正落盘心跳字段。drizzle numeric 列要求 string，故 cpu/loadavg 用 toFixed(2)。 */
  private async writeHeartbeatToDb(licenseId: number, m: HeartbeatMetrics): Promise<void> {
    const now = new Date();
    await this.conn
      .update(agentsTable)
      .set({
        lastHeartbeatAt: now,
        uptimeSeconds: m.uptimeSeconds,
        cpuPercent: m.cpuPercent.toFixed(2),
        memUsedBytes: m.memUsedBytes,
        memTotalBytes: m.memTotalBytes,
        loadavg1: m.loadavg1.toFixed(2),
        updatedAt: now,
      })
      .where(eq(agentsTable.licenseId, licenseId));
  }

  /** 连接断开时调用：status=offline 并清理本 license 的去抖记录。 */
  async markOfflineByLicense(licenseId: number): Promise<void> {
    const now = new Date();
    await this.conn
      .update(agentsTable)
      .set({ status: 'offline', updatedAt: now })
      .where(eq(agentsTable.licenseId, licenseId));
    this.lastHbWriteAt.delete(licenseId);
  }

  /**
   * 按 license 查 agent 行。
   *
   * 目前 upsertOnline 改原子 upsert 后内部无调用者，
   * 保留 public 供任务 8/9 消费（AgentOfflineScheduler 可能校验、AgentController 可能单查）。
   */
  async findByLicense(licenseId: number) {
    const rows = await this.conn
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.licenseId, licenseId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** GET /agent/my-bot 使用：返回该 customer 下所有状态的 agents。 */
  async listForCustomer(customerId: number) {
    return this.conn
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.customerId, customerId));
  }

  /**
   * OfflineScheduler 调用：将 online 但 last_heartbeat_at 早于 now - thresholdMs 的行批量置 offline。
   * 返回被置 offline 的 licenseId 数组，供调用方日志/metrics。
   */
  async markStaleAsOffline(thresholdMs: number): Promise<number[]> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const updated = await this.conn
      .update(agentsTable)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(
        and(
          eq(agentsTable.status, 'online'),
          lt(agentsTable.lastHeartbeatAt, cutoff),
        ),
      )
      .returning({ licenseId: agentsTable.licenseId });
    return updated.map((r) => r.licenseId);
  }
}
