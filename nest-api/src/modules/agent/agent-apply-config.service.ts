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
  energyPlatformConfigTable,
  licensesTable,
  userTable,
} from '../../drizzle/schema';
import { AgentRegistry } from './agent.registry';
import { deriveTronAddress } from './util/tron-address.util';

/**
 * applyConfig 服务（B3-T11.4）：给 agent 下发完整运行配置。
 *
 * 职责：
 * - 根据 licenseId 汇总 user → customer → license ownership 校验（防越权）
 * - 从 energy_platform_config（单例）+ agent_bot_configs（agentProfileId 绑定）读全量字段
 * - 动态派生 platform_receive_address：
 *     - justlend 模式 = justlendPayerPrivateKey 对应钱包地址
 *     - catfee 模式   = catfeePayerPrivateKey 对应钱包地址（T11.11 引入）
 *   两种模式 bot 端都需要此地址做用户付款收款（bot.go:243 / executor.go:345）
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
 *   T11.6 加密版本完成后这里改传 base64(nonce+ciphertext) 并标 encryption=aes-gcm
 * - `deriveTronAddressFn` 是测试钩：不注入则走真实 tronweb 派生
 */
@Injectable()
export class AgentApplyConfigService {
  private readonly logger = new Logger(AgentApplyConfigService.name);

  /**
   * 测试钩：jest 注入 fake 派生函数绕过 tronweb 真实调用
   * 生产路径走默认 deriveTronAddress util
   */
  private deriveTronAddressFn: (
    privateKey: string,
    tronApiBaseUrl: string,
    tronApiKey?: string,
  ) => Promise<string> = (privateKey, tronApiBaseUrl, tronApiKey) =>
    deriveTronAddress({ privateKey, tronApiBaseUrl, tronApiKey });

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
   * - justlend 模式下派生地址失败 → 500（私钥格式坏，系统级异常客户无法处理）
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
        justlendContractAddress:
          energyPlatformConfigTable.justlendContractAddress,
        justlendPayerPrivateKey:
          energyPlatformConfigTable.justlendPayerPrivateKey,
        catfeePayerPrivateKey:
          energyPlatformConfigTable.catfeePayerPrivateKey,
        energyProvider: energyPlatformConfigTable.energyProvider,
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

    // 6. 派生 platformReceiveAddress
    //    两种 provider 都需要：用户打款的 TRX/USDT 平台收款地址
    //      - justlend: 从 justlendPayerPrivateKey 派生（也兼任归还给 justlend 池的地址）
    //      - catfee:   从 catfeePayerPrivateKey 派生（T11.11 起引入对称字段）
    //    bot 端 go-bot-v2/internal/telegram/bot.go:243、executor.go:345
    //    两种模式都会用此地址查 TronGrid incoming transfers / 作为收款地址展示
    let platformReceiveAddress = '';
    let receivePrivateKey: string | null = null;
    let receiveSource = '';
    if (plat.energyProvider === 'justlend') {
      receivePrivateKey = plat.justlendPayerPrivateKey;
      receiveSource = 'justlend_payer_private_key';
    } else if (plat.energyProvider === 'catfee') {
      receivePrivateKey = plat.catfeePayerPrivateKey;
      receiveSource = 'catfee_payer_private_key';
    } else {
      // 其他未知 provider 不下发非空地址；由 bot 端 required 校验报错
      // （保底路径，日常配置校验应在 platformConfig 保存时拦截）
    }

    if (!receivePrivateKey || !receivePrivateKey.trim()) {
      // 私钥缺失是系统配置错误，不是客户操作可修复
      // 拒绝下发避免 bot 启动后因 PLATFORM_RECEIVE_ADDRESS required 死循环 exit 1
      this.logger.error(
        `平台收款私钥未配置 license=${licenseId} provider=${plat.energyProvider} source=${receiveSource}`,
      );
      throw new InternalServerErrorException(
        `平台收款私钥（${receiveSource}）未配置，无法派生收款地址`,
      );
    }

    try {
      platformReceiveAddress = await this.deriveTronAddressFn(
        receivePrivateKey,
        plat.tronApiBaseUrl,
        plat.tronApiKey ?? undefined,
      );
    } catch (err) {
      this.logger.error(
        `派生 TRON 地址失败 license=${licenseId} source=${receiveSource}: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        '平台付款私钥无法派生钱包地址，请检查配置',
      );
    }

    // 7. 组装 params（camelCase，与 go-bot-v2 apply_config.go Params struct 对齐）
    const params = {
      databaseUrl: '/var/lib/energybot-agent/bot.db',
      platform: {
        tronApiBaseUrl: plat.tronApiBaseUrl,
        tronApiKey: plat.tronApiKey ?? '',
        platformReceiveAddress,
        justlendContractAddress: plat.justlendContractAddress ?? '',
        justlendPayerPrivateKey: plat.justlendPayerPrivateKey ?? '',
        catfeePayerPrivateKey: plat.catfeePayerPrivateKey ?? '',
        energyProvider: plat.energyProvider,
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
    };

    // 8. 下发 agent.applyConfig request，等待 agent 回 result
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
      `applyConfig license=${licenseId} user=${userId} 已下发 (provider=${plat.energyProvider})`,
    );
  }
}
