import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import * as schema from '../../drizzle/schema';
import {
  agentBotConfigsTable,
  agentProfilesTable,
  energyPackagesTable,
  energyPlatformConfigTable,
  licensesTable,
  userTable,
} from '../../drizzle/schema';
import { AgentRegistry } from './agent.registry';

/**
 * applyConfig 服务（B3-T11.4，T12 架构更新）：给 agent 下发完整运行配置。
 *
 * 职责：
 * - 根据 licenseId 汇总 user → customer → license ownership 校验（防越权）
 * - 从 energy_platform_config（单例）+ agent_bot_configs（agentProfileId 绑定）读全量字段
 * - 下发平台统一收款地址（platform_receive_address，运营手填的 TRON Base58）
 *   bot 端 go-bot-v2/internal/telegram/bot.go:243、executor.go:345
 *   用此地址查 TronGrid incoming transfers / 作为收款地址展示
 * - 组装 camelCase JSON → AgentRegistry.sendToAgent('agent.applyConfig', params)
 *
 * 与 MyBotActionService 的关系：
 * - 调用方（MyBotActionService.start）在 bot.start 之前先调本 service.applyConfig
 * - 失败语义：配置缺失 → NotFound/InternalServerError；agent 离线 → ServiceUnavailable
 *   让 MyBotActionService.start 把异常原样冒泡给前端
 *
 * 设计要点：
 * - applyConfig 参数按 go-bot-v2 cmd/bot/apply_config.go 期望的 JSON schema 组装
 *   字段命名 camelCase 与 Go 侧 json tag 一致（避免两边各转一次）
 * - databaseUrl 写死 '/var/lib/energybot-agent/bot.db'（裸路径，Go storage.Open
 *   不接受 sqlite:// scheme）—— agent main 已 mkdir 此目录
 * - token MVP 明文：这里 params.bot.token 是明文；go-bot-v2 的 apply_config.go
 *   会按 "nonce=NULL 明文" 路径 UPSERT bot_config.encrypted_token
 */
@Injectable()
export class AgentApplyConfigService {
  private readonly logger = new Logger(AgentApplyConfigService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly conn: NodePgDatabase<typeof schema>,
    private readonly registry: AgentRegistry,
  ) {}

  /**
   * 构造 applyConfig params 并下发给 agent。
   *
   * 失败路径：
   * - user / license / agent_profile / bot_config 任何一环找不到 → 拒绝
   *   （注意 platform_config 缺失是系统级错误不是客户错误 → 500）
   * - platformReceiveAddress 未配置 → 500（系统级错误，不能下发空地址让 bot 死循环）
   * - agent 离线 → 503
   */
  async applyConfig(userId: number, licenseId: number): Promise<void> {
    // 1. user 存在且绑 customer
    const userRows = await this.conn
      .select({ customerId: userTable.customerId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (userRows.length === 0 || userRows[0].customerId == null) {
      throw new NotFoundException('用户或客户绑定缺失');
    }

    // 2. license ownership
    const licRows = await this.conn
      .select({ id: licensesTable.id })
      .from(licensesTable)
      .where(
        and(
          eq(licensesTable.id, licenseId),
          eq(licensesTable.customerId, userRows[0].customerId),
          isNull(licensesTable.revokedAt),
        ),
      )
      .limit(1);
    if (licRows.length === 0) {
      // 与 MyBotActionService 口径一致：404 避免 licenseId 枚举
      throw new NotFoundException('license 不存在或无权访问');
    }

    // 3. agent_profile 绑定关系：agent_profiles.userId === 当前登录 user.id
    //    （与 EnergyRentalService.resolveAccessScope 口径一致）
    //    不是 customer_id——agent_profile 登记的是「哪个 user 是该 customer 的
    //    agent 管理员」。业务上同 customer 可能多个 user，但 agent_profile 只绑
    //    其中一个（当前 MVP 每 customer 一条，多 user 场景后续再议）
    const agentRows = await this.conn
      .select({ id: agentProfilesTable.id })
      .from(agentProfilesTable)
      .where(eq(agentProfilesTable.userId, userId))
      .limit(1);
    if (agentRows.length === 0) {
      throw new NotFoundException('该用户未配置 agent_profile');
    }
    const agentProfileId = agentRows[0].id;

    // 4. bot_config（每 agent 一条）
    const botCfgRows = await this.conn
      .select({
        telegramBotToken: agentBotConfigsTable.telegramBotToken,
        telegramBotUsername: agentBotConfigsTable.telegramBotUsername,
        welcomeText: agentBotConfigsTable.welcomeText,
        menuConfig: agentBotConfigsTable.menuConfig,
        messageConfig: agentBotConfigsTable.messageConfig,
      })
      .from(agentBotConfigsTable)
      .where(eq(agentBotConfigsTable.agentId, agentProfileId))
      .limit(1);
    if (botCfgRows.length === 0 || !botCfgRows[0].telegramBotToken) {
      throw new NotFoundException('bot 配置缺失或 token 未设置');
    }
    const botCfg = botCfgRows[0];

    // 5. platform config（单例）
    const platRows = await this.conn
      .select({
        tronApiBaseUrl: energyPlatformConfigTable.tronApiBaseUrl,
        tronApiKey: energyPlatformConfigTable.tronApiKey,
        platformReceiveAddress: energyPlatformConfigTable.platformReceiveAddress,
        catfeeEnvironment: energyPlatformConfigTable.catfeeEnvironment,
        catfeeProdApiBaseUrl: energyPlatformConfigTable.catfeeProdApiBaseUrl,
        catfeeProdApiKey: energyPlatformConfigTable.catfeeProdApiKey,
        catfeeProdApiSecret: energyPlatformConfigTable.catfeeProdApiSecret,
        catfeeNileApiBaseUrl: energyPlatformConfigTable.catfeeNileApiBaseUrl,
        catfeeNileApiKey: energyPlatformConfigTable.catfeeNileApiKey,
        catfeeNileApiSecret: energyPlatformConfigTable.catfeeNileApiSecret,
        catfeeAutoActivate: energyPlatformConfigTable.catfeeAutoActivate,
        orderPaymentTtlMinutes:
          energyPlatformConfigTable.orderPaymentTtlMinutes,
        telegramPollingIntervalSeconds:
          energyPlatformConfigTable.telegramPollingIntervalSeconds,
        workerIntervalSeconds: energyPlatformConfigTable.workerIntervalSeconds,
        minTrxReserveSun: energyPlatformConfigTable.minTrxReserveSun,
      })
      .from(energyPlatformConfigTable)
      .limit(1);
    if (platRows.length === 0) {
      throw new InternalServerErrorException('平台配置未初始化');
    }
    const plat = platRows[0];

    // 6. 平台统一收款地址（T12：运营手填，不再派生）
    //    bot 端 go-bot-v2/internal/telegram/bot.go:243、executor.go:345
    //    用此地址查 TronGrid incoming transfers / 作为收款地址展示
    const platformReceiveAddress = String(
      plat.platformReceiveAddress ?? '',
    ).trim();
    if (!platformReceiveAddress) {
      // 未配置是系统级错误，不能下发空地址让 bot 因 PLATFORM_RECEIVE_ADDRESS required 死循环 exit 1
      this.logger.error(
        `平台统一收款地址未配置 license=${licenseId}`,
      );
      throw new InternalServerErrorException(
        '平台统一收款地址（platform_receive_address）未配置，请在管理台录入后重试',
      );
    }

    // 7. packages（该 agent 的 user_package + 关联的 platform_price 基础数据）
    //    Go bot-v2 本地 SQLite energy_packages 表需要这些数据来展示套餐菜单
    //    查询逻辑：先取 user_package（属于此 agent），再 LEFT JOIN platform_price
    //    拿到基础的 energy_amount/duration_hours（与 Go bot listPackages 查询对齐）
    const pkgRows = await this.conn
      .select({
        id: energyPackagesTable.id,
        platformPackageId: energyPackagesTable.platformPackageId,
        packageKind: energyPackagesTable.packageKind,
        packageName: energyPackagesTable.packageName,
        energyAmount: energyPackagesTable.energyAmount,
        durationHours: energyPackagesTable.durationHours,
        priceSun: energyPackagesTable.priceSun,
        idlePriceSun: energyPackagesTable.idlePriceSun,
        busyPriceSun: energyPackagesTable.busyPriceSun,
        status: energyPackagesTable.status,
        sortOrder: energyPackagesTable.sortOrder,
        description: energyPackagesTable.description,
      })
      .from(energyPackagesTable)
      .where(
        and(
          eq(energyPackagesTable.agentId, agentProfileId),
          eq(energyPackagesTable.packageKind, 'user_package'),
          isNull(energyPackagesTable.deletedAt),
        ),
      );

    const packages = pkgRows.map((p) => ({
      id: p.id,
      platformPackageId: p.platformPackageId,
      packageKind: p.packageKind,
      packageName: p.packageName,
      energyAmount: p.energyAmount,
      durationHours: p.durationHours,
      priceSun: String(p.priceSun ?? '0'),
      idlePriceSun: String(p.idlePriceSun ?? p.priceSun ?? '0'),
      busyPriceSun: String(p.busyPriceSun ?? p.priceSun ?? '0'),
      status: p.status,
      sortOrder: p.sortOrder ?? 0,
      description: p.description ?? '',
    }));

    // 8. 组装 params（camelCase，与 go-bot-v2 apply_config.go Params struct 对齐）
    const params = {
      databaseUrl: '/var/lib/energybot-agent/bot.db',
      platform: {
        tronApiBaseUrl: plat.tronApiBaseUrl,
        tronApiKey: plat.tronApiKey ?? '',
        platformReceiveAddress,
        catfeeEnvironment: plat.catfeeEnvironment,
        catfeeProdApiBaseUrl: plat.catfeeProdApiBaseUrl,
        catfeeProdApiKey: plat.catfeeProdApiKey ?? '',
        catfeeProdApiSecret: plat.catfeeProdApiSecret ?? '',
        catfeeNileApiBaseUrl: plat.catfeeNileApiBaseUrl,
        catfeeNileApiKey: plat.catfeeNileApiKey ?? '',
        catfeeNileApiSecret: plat.catfeeNileApiSecret ?? '',
        catfeeAutoActivate: plat.catfeeAutoActivate,
        orderPaymentTtlMinutes: plat.orderPaymentTtlMinutes,
        telegramPollingIntervalSeconds: plat.telegramPollingIntervalSeconds,
        workerIntervalSeconds: plat.workerIntervalSeconds,
        minTrxReserveSun: String(plat.minTrxReserveSun ?? '0'),
      },
      bot: {
        token: botCfg.telegramBotToken,
        username: botCfg.telegramBotUsername ?? '',
        welcomeText: botCfg.welcomeText ?? '',
        menuConfig: botCfg.menuConfig ?? '',
        messageConfig: botCfg.messageConfig ?? '',
      },
      packages,
    };

    // 9. 下发 agent.applyConfig request，等待 agent 回 result
    //    T11.10 升级：由 notification 改为 JSON-RPC request，避免 bot.start
    //    与 agent.applyConfig 并发 goroutine 在 bot 进程冷启时争抢 SQLite 锁
    //    超时 15s：apply-config 子进程 cold start + migration + UPSERT 一般 < 2s，
    //    留 10x buffer 兜底 cgo 冷启/磁盘 stall
    try {
      await this.registry.callAgent(
        licenseId,
        'agent.applyConfig',
        params,
        15_000,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `applyConfig license=${licenseId} user=${userId} 失败：${msg}`,
      );
      if (err instanceof ServiceUnavailableException) throw err;
      // 其他一切错误（timeout / agent-error / unexpected）归一为 503，
      // 业务语义："agent 当前无法完成配置下发，请稍后重试"
      throw new ServiceUnavailableException('agent 配置下发失败，请稍后重试');
    }
    this.logger.log(
      `applyConfig license=${licenseId} user=${userId} 已下发`,
    );
  }

  /**
   * 按 userId 查找 license 并触发 applyConfig。
   * 用于套餐增删改后静默推送最新 packages 到 agent SQLite。
   *
   * 失败时只 warn 不抛异常——不阻塞主业务流程（套餐 CRUD 已成功入库）。
   */
  async applyConfigSilent(userId: number): Promise<void> {
    try {
      // 1. user → customerId
      const userRows = await this.conn
        .select({ customerId: userTable.customerId })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);
      if (userRows.length === 0 || userRows[0].customerId == null) return;

      // 2. customerId → licenseId（取第一个未 revoke 的）
      const licRows = await this.conn
        .select({ id: licensesTable.id })
        .from(licensesTable)
        .where(
          and(
            eq(licensesTable.customerId, userRows[0].customerId),
            isNull(licensesTable.revokedAt),
          ),
        )
        .limit(1);
      if (licRows.length === 0) return;

      await this.applyConfig(userId, licRows[0].id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`applyConfigSilent user=${userId} 失败（非阻塞）：${msg}`);
    }
  }
}
