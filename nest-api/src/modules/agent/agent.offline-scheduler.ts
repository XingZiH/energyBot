import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AgentService } from './agent.service';
import { AgentRegistry } from './agent.registry';

/**
 * AgentOfflineScheduler —— 心跳超时批量置 offline + 清理进程内 WS 槽位。
 *
 * 职责：
 * 每 30s 触发一次 scan：
 *   1. 调 AgentService.markStaleAsOffline(90_000) 把 online 且 last_heartbeat_at < now - 90s
 *      的行批量 UPDATE 成 offline，拿回受影响的 licenseId 列表（幂等由 WHERE 保证）。
 *   2. 对每个 licenseId：若 registry 仍留有 ws 槽位（gateway 层 close 回调未跑/已 kill），
 *      调 ws.terminate() 粗暴切断 + registry.unregister 释放 Map 条目。
 *      若 licenseId 不在 registry 中，DB 已清、内存无遗留，跳过即可。
 *
 * 错误隔离：
 *   - 单个 licenseId 的 ws 清理失败不影响其他 licenseId（try/catch 包在 for 内部）。
 *   - ws.terminate 抛错后 unregister 仍要执行，防止 Map 永久泄漏。
 *   - 异常走 logger.debug（ws 已 close 的 EPIPE/ETIMEDOUT 是常态，不刷屏 error）。
 *
 * 启动：
 *   @Cron 默认不立即触发，首次在 30s 后执行，符合预期。
 *
 * 单实例假设：
 *   B1 单进程部署，Map 状态进程内独享。多实例需改方案（plan 已说明）。
 */
@Injectable()
export class AgentOfflineScheduler {
  /** 心跳超时阈值：90s 未上报即判为离线。需与 plan 口径一致。 */
  static readonly OFFLINE_THRESHOLD_MS = 90_000;

  private readonly logger = new Logger(AgentOfflineScheduler.name);

  constructor(
    private readonly agents: AgentService,
    private readonly registry: AgentRegistry,
  ) {}

  /**
   * 每 30s 执行。cron 用 6 字段（秒精度）—— @nestjs/schedule 的 CronExpression 枚举
   * 没有 EVERY_30_SECONDS，用字面量 `* / 30 * * * * *`（实际无空格）最直接。
   */
  @Cron('*/30 * * * * *')
  async scan(): Promise<void> {
    const stale = await this.agents.markStaleAsOffline(
      AgentOfflineScheduler.OFFLINE_THRESHOLD_MS,
    );
    if (stale.length === 0) return;

    this.logger.log(
      `${stale.length} 个 agent 心跳超时置 offline: ${stale.join(',')}`,
    );

    for (const licenseId of stale) {
      const slot = this.registry.get(licenseId);
      if (slot == null) continue; // DB 已清，registry 无遗留，跳过

      // terminate 独立 try：EPIPE/ETIMEDOUT 等底层异常不阻断 unregister。
      try {
        slot.ws.terminate();
      } catch (e) {
        this.logger.debug(
          `license ${licenseId} ws.terminate 失败（ws 可能已销毁）: ${(e as Error).message}`,
        );
      }

      // unregister 独立 try：防御性——理论上 registry.unregister 不抛，
      // 但放单独 try 保证就算抛了也不影响后续 licenseId。
      try {
        this.registry.unregister(licenseId, slot.ws);
      } catch (e) {
        this.logger.debug(
          `license ${licenseId} registry.unregister 失败: ${(e as Error).message}`,
        );
      }
    }
  }
}
