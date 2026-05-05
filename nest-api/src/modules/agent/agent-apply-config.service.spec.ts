import { Test } from '@nestjs/testing';
import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import { AgentRegistry } from './agent.registry';
import { AgentApplyConfigService } from './agent-apply-config.service';

/**
 * AgentApplyConfigService 测试。
 *
 * 关注点：
 * - buildParams 路径：licenseId → agent_profile_id → 拼装 platform + bot 全字段
 * - applyConfig 路径：buildParams 成功后 registry.sendToAgent('agent.applyConfig', params)
 *   返 false 抛 ServiceUnavailable
 *
 * 不关注：
 * - tronWeb 派生地址实际逻辑——通过 mock deriveTronAddress 注入
 *
 * mock 策略：
 * - 把 conn 替换成 fakeConn，select() 链返回固定 row 数组
 * - registry mock sendToAgent
 * - deriveTronAddress 通过 `(svc as any).deriveTronAddressOverride` 注入测试钩
 */
describe('AgentApplyConfigService', () => {
  /** fakeConn：select.from.where.limit() 链返回固定 fixture 集 */
  function makeFakeConn(fixtures: {
    user?: Array<{ customerId: number | null }>;
    license?: Array<{ id: number }>;
    agentProfile?: Array<{ id: number }>;
    botConfig?: Array<{
      telegramBotToken: string | null;
      telegramBotUsername: string | null;
      welcomeText: string | null;
      menuConfig: string | null;
      messageConfig: string | null;
    }>;
    platformConfig?: Array<{
      tronApiBaseUrl: string;
      tronApiKey: string | null;
      justlendContractAddress: string | null;
      justlendPayerPrivateKey: string | null;
      catfeePayerPrivateKey: string | null;
      energyProvider: string;
      catfeeEnvironment: string;
      catfeeProdApiBaseUrl: string;
      catfeeProdApiKey: string | null;
      catfeeProdApiSecret: string | null;
      catfeeNileApiBaseUrl: string;
      catfeeNileApiKey: string | null;
      catfeeNileApiSecret: string | null;
      catfeeAutoActivate: boolean;
      orderPaymentTtlMinutes: number;
      telegramPollingIntervalSeconds: number;
      workerIntervalSeconds: number;
      minTrxReserveSun: string;
    }>;
  }) {
    let callIdx = 0;
    // 顺序：user → license → agentProfile → botConfig → platformConfig
    // 与 service 内部查询顺序严格一致
    const sequence = [
      fixtures.user ?? [],
      fixtures.license ?? [],
      fixtures.agentProfile ?? [],
      fixtures.botConfig ?? [],
      fixtures.platformConfig ?? [],
    ];

    // drizzle 链有两种形态：
    // - .select().from().where().limit(n)           — 大多数 ownership 查询
    // - .select().from().limit(n)                    — 单例查询（platform_config）
    // fakeConn 必须两种都支持
    const chain = (rows: unknown[]) => {
      const limitFn = { limit: () => Promise.resolve(rows) };
      return {
        from: () => ({
          where: () => limitFn,
          limit: limitFn.limit,
        }),
      };
    };

    return {
      select: () => {
        const rows = sequence[callIdx] ?? [];
        callIdx += 1;
        return chain(rows);
      },
    };
  }

  function makeRegistry() {
    return {
      callAgent: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as jest.Mocked<Pick<AgentRegistry, 'callAgent'>>;
  }

  async function buildSvc(
    conn: unknown,
    registry: unknown,
    deriveAddr?: (
      privateKey: string,
      tronApiBaseUrl: string,
      tronApiKey?: string,
    ) => Promise<string>,
  ) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentApplyConfigService,
        { provide: DrizzleAsyncProvider, useValue: conn },
        { provide: AgentRegistry, useValue: registry },
      ],
    }).compile();
    const svc = moduleRef.get(AgentApplyConfigService);
    if (deriveAddr) {
      // 测试时绕过真实 tronweb，注入派生函数
      (
        svc as unknown as { deriveTronAddressFn: typeof deriveAddr }
      ).deriveTronAddressFn = deriveAddr;
    }
    return svc;
  }

  it('happy path：组装 platform + bot 全字段并 sendToAgent', async () => {
    const conn = makeFakeConn({
      user: [{ customerId: 100 }],
      license: [{ id: 4 }],
      agentProfile: [{ id: 1 }],
      botConfig: [
        {
          telegramBotToken: '123:ABC',
          telegramBotUsername: 'mybot',
          welcomeText: 'welcome',
          menuConfig: '{"items":[]}',
          messageConfig: '{"fallback":"hi"}',
        },
      ],
      platformConfig: [
        {
          tronApiBaseUrl: 'https://api.trongrid.io',
          tronApiKey: 'tron-key',
          justlendContractAddress: 'TCONTRACT',
          justlendPayerPrivateKey:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          catfeePayerPrivateKey: null,
          energyProvider: 'justlend',
          catfeeEnvironment: 'nile',
          catfeeProdApiBaseUrl: 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: 'https://nile.catfee.io',
          catfeeNileApiKey: '',
          catfeeNileApiSecret: '',
          catfeeAutoActivate: true,
          orderPaymentTtlMinutes: 10,
          telegramPollingIntervalSeconds: 2,
          workerIntervalSeconds: 60,
          minTrxReserveSun: '0',
        },
      ],
    });
    const registry = makeRegistry();
    const svc = await buildSvc(conn, registry, () =>
      Promise.resolve('TDERIVED12345'),
    );

    await svc.applyConfig(50, 4); // userId=50, licenseId=4

    expect(registry.callAgent).toHaveBeenCalledTimes(1);
    const [licenseId, method, params, timeoutMs] =
      registry.callAgent.mock.calls[0];
    expect(licenseId).toBe(4);
    expect(method).toBe('agent.applyConfig');
    expect(typeof timeoutMs).toBe('number');
    expect(timeoutMs).toBeGreaterThan(0);
    const p = params as Record<string, unknown>;
    expect(p.databaseUrl).toBe('/var/lib/energybot-agent/bot.db');
    expect(p.platform).toMatchObject({
      tronApiBaseUrl: 'https://api.trongrid.io',
      tronApiKey: 'tron-key',
      platformReceiveAddress: 'TDERIVED12345',
      energyProvider: 'justlend',
    });
    // 私钥透传，长度 64 hex
    expect(
      (p.platform as Record<string, unknown>).justlendPayerPrivateKey,
    ).toHaveLength(64);
    expect(p.bot).toMatchObject({
      token: '123:ABC',
      username: 'mybot',
      welcomeText: 'welcome',
      menuConfig: '{"items":[]}',
      messageConfig: '{"fallback":"hi"}',
    });
  });

  it('agent 离线（callAgent reject 503）→ ServiceUnavailableException 透传', async () => {
    const conn = makeFakeConn({
      user: [{ customerId: 100 }],
      license: [{ id: 4 }],
      agentProfile: [{ id: 1 }],
      botConfig: [
        {
          telegramBotToken: '123:ABC',
          telegramBotUsername: 'mybot',
          welcomeText: '',
          menuConfig: null,
          messageConfig: null,
        },
      ],
      platformConfig: [
        {
          tronApiBaseUrl: 'https://api.trongrid.io',
          tronApiKey: '',
          justlendContractAddress: '',
          justlendPayerPrivateKey: '',
          catfeePayerPrivateKey:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          energyProvider: 'catfee',
          catfeeEnvironment: 'nile',
          catfeeProdApiBaseUrl: 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: 'https://nile.catfee.io',
          catfeeNileApiKey: 'nk',
          catfeeNileApiSecret: 'ns',
          catfeeAutoActivate: true,
          orderPaymentTtlMinutes: 10,
          telegramPollingIntervalSeconds: 2,
          workerIntervalSeconds: 60,
          minTrxReserveSun: '0',
        },
      ],
    });
    const registry = makeRegistry();
    registry.callAgent.mockRejectedValue(
      new ServiceUnavailableException('agent license=4 未在线'),
    );
    const svc = await buildSvc(conn, registry, () => Promise.resolve('X'));

    await expect(svc.applyConfig(50, 4)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('agent 回 error（apply-config exec 失败）→ ServiceUnavailableException', async () => {
    const conn = makeFakeConn({
      user: [{ customerId: 100 }],
      license: [{ id: 4 }],
      agentProfile: [{ id: 1 }],
      botConfig: [
        {
          telegramBotToken: '123:ABC',
          telegramBotUsername: 'mybot',
          welcomeText: '',
          menuConfig: null,
          messageConfig: null,
        },
      ],
      platformConfig: [
        {
          tronApiBaseUrl: 'https://api.trongrid.io',
          tronApiKey: '',
          justlendContractAddress: '',
          justlendPayerPrivateKey: '',
          catfeePayerPrivateKey:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          energyProvider: 'catfee',
          catfeeEnvironment: 'nile',
          catfeeProdApiBaseUrl: 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: 'https://nile.catfee.io',
          catfeeNileApiKey: 'nk',
          catfeeNileApiSecret: 'ns',
          catfeeAutoActivate: true,
          orderPaymentTtlMinutes: 10,
          telegramPollingIntervalSeconds: 2,
          workerIntervalSeconds: 60,
          minTrxReserveSun: '0',
        },
      ],
    });
    const registry = makeRegistry();
    registry.callAgent.mockRejectedValue(
      new Error('agent error code=-40001 message=apply-config 进程退出'),
    );
    const svc = await buildSvc(conn, registry, () => Promise.resolve('X'));

    // service 把任意 callAgent 错误归一为 503，避免业务调用方区分网络/逻辑错
    await expect(svc.applyConfig(50, 4)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // ============================================================
  // T11.11：catfee 模式下也必须派生 platformReceiveAddress 下发
  //
  // 根因背景：
  //   原代码只在 energyProvider==='justlend' 时派生地址，catfee 模式下
  //   platformReceiveAddress='' 透传，触发 go-bot-v2 validateRuntimeConfig
  //   PLATFORM_RECEIVE_ADDRESS required 校验失败，bot exit 1。
  //
  // 修复：catfee 模式从 catfeePayerPrivateKey 派生地址，与 justlend 对称。
  // ============================================================

  it('catfee 模式：从 catfeePayerPrivateKey 派生 platformReceiveAddress 并下发', async () => {
    const derivedAddr = 'TCATFEEDERIVED777';
    const catfeePk =
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const callsTo: Array<{ pk: string; baseUrl: string; key?: string }> = [];

    const conn = makeFakeConn({
      user: [{ customerId: 100 }],
      license: [{ id: 4 }],
      agentProfile: [{ id: 1 }],
      botConfig: [
        {
          telegramBotToken: '123:ABC',
          telegramBotUsername: 'mybot',
          welcomeText: 'hi',
          menuConfig: null,
          messageConfig: null,
        },
      ],
      platformConfig: [
        {
          tronApiBaseUrl: 'https://api.trongrid.io',
          tronApiKey: 'tron-key',
          justlendContractAddress: '',
          justlendPayerPrivateKey: '',
          catfeePayerPrivateKey: catfeePk,
          energyProvider: 'catfee',
          catfeeEnvironment: 'nile',
          catfeeProdApiBaseUrl: 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: 'https://nile.catfee.io',
          catfeeNileApiKey: 'nk',
          catfeeNileApiSecret: 'ns',
          catfeeAutoActivate: true,
          orderPaymentTtlMinutes: 10,
          telegramPollingIntervalSeconds: 2,
          workerIntervalSeconds: 60,
          minTrxReserveSun: '0',
        },
      ],
    });
    const registry = makeRegistry();
    const svc = await buildSvc(conn, registry, async (pk, baseUrl, key) => {
      callsTo.push({ pk, baseUrl, key });
      return derivedAddr;
    });

    await svc.applyConfig(50, 4);

    // 1. 派生函数被调用：使用 catfee 私钥（不是 justlend 的空字符串）
    expect(callsTo).toHaveLength(1);
    expect(callsTo[0].pk).toBe(catfeePk);
    expect(callsTo[0].baseUrl).toBe('https://api.trongrid.io');
    expect(callsTo[0].key).toBe('tron-key');

    // 2. 下发的 platformReceiveAddress 是派生地址而非空串
    expect(registry.callAgent).toHaveBeenCalledTimes(1);
    const params = registry.callAgent.mock.calls[0][2] as Record<
      string,
      unknown
    >;
    const platform = params.platform as Record<string, unknown>;
    expect(platform.platformReceiveAddress).toBe(derivedAddr);
    expect(platform.energyProvider).toBe('catfee');

    // 3. catfee 私钥透传（agent 端可能用于内部签名 / 后续扩展）
    expect(platform.catfeePayerPrivateKey).toBe(catfeePk);

    // 4. justlend 字段保持为空字符串（catfee 模式下不需要）
    expect(platform.justlendPayerPrivateKey).toBe('');
  });

  it('catfee 模式但 catfeePayerPrivateKey 缺失 → 500（配置错误，不能下发空地址）', async () => {
    const conn = makeFakeConn({
      user: [{ customerId: 100 }],
      license: [{ id: 4 }],
      agentProfile: [{ id: 1 }],
      botConfig: [
        {
          telegramBotToken: '123:ABC',
          telegramBotUsername: 'mybot',
          welcomeText: '',
          menuConfig: null,
          messageConfig: null,
        },
      ],
      platformConfig: [
        {
          tronApiBaseUrl: 'https://api.trongrid.io',
          tronApiKey: '',
          justlendContractAddress: '',
          justlendPayerPrivateKey: '',
          catfeePayerPrivateKey: null, // ← 缺失
          energyProvider: 'catfee',
          catfeeEnvironment: 'nile',
          catfeeProdApiBaseUrl: 'https://api.catfee.io',
          catfeeProdApiKey: '',
          catfeeProdApiSecret: '',
          catfeeNileApiBaseUrl: 'https://nile.catfee.io',
          catfeeNileApiKey: 'nk',
          catfeeNileApiSecret: 'ns',
          catfeeAutoActivate: true,
          orderPaymentTtlMinutes: 10,
          telegramPollingIntervalSeconds: 2,
          workerIntervalSeconds: 60,
          minTrxReserveSun: '0',
        },
      ],
    });
    const registry = makeRegistry();
    const svc = await buildSvc(conn, registry, () =>
      Promise.resolve('SHOULD_NOT_BE_CALLED'),
    );

    // 与 justlend 私钥派生失败一致：500（系统级配置错误）
    await expect(svc.applyConfig(50, 4)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    // 派生地址失败时不应该下发给 agent
    expect(registry.callAgent).not.toHaveBeenCalled();
  });
});
