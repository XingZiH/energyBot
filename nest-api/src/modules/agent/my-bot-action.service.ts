import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import { licensesTable, userTable } from '../../drizzle/schema';
import { AgentApplyConfigService } from './agent-apply-config.service';
import { AgentRegistry } from './agent.registry';

/**
 * 「我的 Bot」动作服务：终端客户对自己的 agent 下发 bot.start/stop/reload。
 *
 * 安全模型（B3-T5 D2 决策）：
 * - 入参 userId 永远来自 JWT（controller 从 req.user.userId 取），不信任任何传入
 * - userId → user.customerId 反查，customerId 为 null 抛 NotFound（账号未绑客户）
 * - licenseId 必须属于同 customerId 且未被软删（deleted_at IS NULL），否则 Forbidden
 *   拒绝写 404：避免返回 404/403 不同状态导致 licenseId 枚举攻击，统一 Forbidden
 * - 通过 AgentRegistry.sendToAgent 下发 JSON-RPC notification（无 id，fire-and-forget）
 *   registry 返 false（agent 离线/send 失败）→ 503 ServiceUnavailable
 *
 * 动作语义：
 * - start(licenseId): 先下发 agent.applyConfig 同步最新平台 + bot 配置到 agent
 *   本地 SQLite，再下发 bot.start 让 supervisor 拉起 bot 进程；幂等
 *   注意：applyConfig 失败（agent 离线 / 配置缺失）会直接抛出阻断 bot.start，
 *   防止用旧配置启动；这是 B3-T11.7 的关键决策
 * - stop(licenseId): 下发 bot.stop，agent 端 supervisor.Stop()；幂等
 *   不需要 applyConfig（停止只是 SIGTERM，无需配置）
 * - reload(licenseId): 下发 bot.reload，agent 端 supervisor.Reload()（stop-then-start）
 *   FIXME(T11.x)：reload 是否也要先 applyConfig？语义上「重启用最新配置」更符合
 *   用户预期；MVP 阶段先不加，等用户场景明确再决定
 *
 * 本方法不等待 agent 端确认。真实状态通过下一次心跳 bot 字段反映回主站。
 * 客户端应 poll my-bot GET 或等待 UI 自动刷新（后续迭代加 SSE/WS 推更）。
 */
@Injectable()
export class MyBotActionService {
  private readonly logger = new Logger(MyBotActionService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
    private readonly registry: AgentRegistry,
    private readonly applyConfigSvc: AgentApplyConfigService,
  ) {}

  async start(userId: number, licenseId: number): Promise<void> {
    // 先同步最新配置到 agent 本地 SQLite——applyConfig 内部已做 ownership 校验
    // 与 sendToAgent 失败处理；任何异常直接冒泡给 controller
    await this.applyConfigSvc.applyConfig(userId, licenseId);
    // 配置同步成功后再让 supervisor 拉起 bot 进程
    await this.dispatch(userId, licenseId, 'bot.start');
  }

  async stop(userId: number, licenseId: number): Promise<void> {
    await this.dispatch(userId, licenseId, 'bot.stop');
  }

  async reload(userId: number, licenseId: number): Promise<void> {
    await this.dispatch(userId, licenseId, 'bot.reload');
  }

  /**
   * 统一路径：ownership 校验 + registry.sendToAgent。
   *
   * 分步抛错策略：
   * - user 不存在 / 未绑 customer → NotFoundException（与 MyBotService 文案一致）
   * - license 不属于 customer → ForbiddenException
   * - registry 下发失败 → ServiceUnavailableException（agent 离线可前端重试）
   */
  private async dispatch(
    userId: number,
    licenseId: number,
    method: 'bot.start' | 'bot.stop' | 'bot.reload',
  ): Promise<void> {
    // 1. user → customerId
    const userRows = await this.conn
      .select({ customerId: userTable.customerId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (userRows.length === 0) {
      throw new NotFoundException('用户不存在');
    }
    const customerId = userRows[0].customerId;
    if (customerId === null || customerId === undefined) {
      throw new NotFoundException('当前账号未绑定客户');
    }

    // 2. license ownership：licenseId 必须属于 customer 且未被吊销（revoked_at IS NULL）
    const licRows = await this.conn
      .select({ id: licensesTable.id })
      .from(licensesTable)
      .where(
        and(
          eq(licensesTable.id, licenseId),
          eq(licensesTable.customerId, customerId),
          isNull(licensesTable.revokedAt),
        ),
      )
      .limit(1);
    if (licRows.length === 0) {
      // 统一 Forbidden 避免 404/403 枚举 licenseId
      throw new ForbiddenException('无权操作该 license');
    }

    // 3. 下发 notification。agent 离线或 send 失败 → 503
    const ok = this.registry.sendToAgent(licenseId, method);
    if (!ok) {
      this.logger.warn(
        `dispatch ${method} license=${licenseId} user=${userId} 失败：agent 不在线或通道异常`,
      );
      throw new ServiceUnavailableException('agent 不在线，请稍后重试');
    }
    this.logger.log(
      `dispatch ${method} license=${licenseId} user=${userId} 已下发`,
    );
  }
}
