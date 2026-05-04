import { AgentGateway } from './agent.gateway';
import { PrecheckErrorCode } from '../license/dto/license.dto';
import { AgentRpcErrorCode, JsonRpcErrorCode } from './util/jsonrpc.util';

/**
 * AgentGateway 单元测试（参照计划增订 D9：纯 unit mock）。
 *
 * 不搭真实 ws server；全部走 mock：
 * - LicenseService（verifyPrecheckForHandshake / findActiveByKey）
 * - AgentRegistry（register/unregister/get）
 * - AgentService（upsertOnline/updateHeartbeat/markOfflineByLicense）
 * - ws: { send, close, on, readyState }
 * - req: { headers, socket.remoteAddress }
 *
 * jsonrpc util 不 mock（纯函数）。
 *
 * 错误码语义（AgentRpcErrorCode 枚举值和名字已对齐，无需错位）：
 *   -40001 BAD_REQUEST       协议/参数/签名/时钟/method_not_found
 *   -40003 LICENSE_REVOKED   license/customer 状态类
 *   -40013 FLAPPING          300ms 抗抖动
 *   -40029 NOT_READY         gateway 状态机错位
 *   -40041 REPLACED          后来者赢（旧 ws 收到）
 */

// ---------------- helpers ----------------

type AnyFn = jest.Mock;

function createMockWs() {
  return {
    readyState: 1, // OPEN
    send: jest.fn() as AnyFn,
    close: jest.fn() as AnyFn,
    on: jest.fn() as AnyFn,
  };
}

function createMockReq(overrides: Partial<Record<string, string | undefined>> = {}) {
  const headers = {
    'x-license-key': 'ebt_' + 'A'.repeat(32),
    'x-timestamp': String(Date.now()),
    'x-nonce': 'a'.repeat(32),
    'x-agent-version': '1.0.0',
    'x-signature': '0'.repeat(64),
    ...overrides,
  };
  // 删除值为 undefined 的 header（用于测缺失场景）
  Object.keys(headers).forEach((k) => {
    if ((headers as any)[k] === undefined) delete (headers as any)[k];
  });
  return {
    headers,
    socket: { remoteAddress: '1.2.3.4' },
  };
}

function createMockLicenseService(overrides: {
  verifyResult?: any;
  findActiveResult?: any;
} = {}) {
  const defaultVerify = {
    ok: true,
    licenseId: 101,
    customerId: 7,
    customerName: '测试客户',
  };
  const defaultFindActive = {
    licenseId: 101,
    customerId: 7,
    customerName: '测试客户',
    customerStatus: 'active',
    licenseRevokedAt: null,
    secretCipher: 'ignored',
  };
  return {
    verifyPrecheckForHandshake: jest
      .fn()
      .mockResolvedValue(overrides.verifyResult ?? defaultVerify) as AnyFn,
    findActiveByKey: jest
      .fn()
      .mockResolvedValue(
        overrides.findActiveResult === undefined
          ? defaultFindActive
          : overrides.findActiveResult,
      ) as AnyFn,
  };
}

function createMockRegistry() {
  const store = new Map<number, { ws: any; bootTime: number }>();
  return {
    _store: store,
    register: jest.fn((licenseId: number, ws: any, bootTime: number) => {
      const prev = store.get(licenseId);
      store.set(licenseId, { ws, bootTime });
      return { outcome: prev ? 'replaced' : 'new', previous: prev };
    }) as AnyFn,
    unregister: jest.fn((licenseId: number, ws: any) => {
      const cur = store.get(licenseId);
      if (cur && cur.ws === ws) store.delete(licenseId);
    }) as AnyFn,
    get: jest.fn((licenseId: number) => store.get(licenseId)) as AnyFn,
    touchHeartbeat: jest.fn() as AnyFn,
  };
}

function createMockAgentService() {
  return {
    upsertOnline: jest.fn().mockResolvedValue(undefined) as AnyFn,
    updateHeartbeat: jest.fn().mockResolvedValue(undefined) as AnyFn,
    markOfflineByLicense: jest.fn().mockResolvedValue(undefined) as AnyFn,
  };
}

function createGateway(opts?: {
  license?: any;
  registry?: any;
  agents?: any;
}) {
  const license = opts?.license ?? createMockLicenseService();
  const registry = opts?.registry ?? createMockRegistry();
  const agents = opts?.agents ?? createMockAgentService();
  const gw = new AgentGateway(license as any, registry as any, agents as any);
  return { gw, license, registry, agents };
}

/** 从 ws.send.mock 调用里取第一条 JSON-RPC payload。 */
function firstSent(ws: { send: AnyFn }): any {
  expect(ws.send).toHaveBeenCalled();
  return JSON.parse(ws.send.mock.calls[0][0]);
}

/** 根据 ws.on('close', handler) 绑定里取 close handler。 */
function getCloseHandler(ws: { on: AnyFn }): () => Promise<void> | void {
  const call = ws.on.mock.calls.find((c: any[]) => c[0] === 'close');
  if (!call) throw new Error('ws.on("close", ...) 未绑定');
  return call[1];
}

/** 同理取 message handler。 */
function getMessageHandler(ws: { on: AnyFn }): (buf: any) => Promise<void> | void {
  const call = ws.on.mock.calls.find((c: any[]) => c[0] === 'message');
  if (!call) throw new Error('ws.on("message", ...) 未绑定');
  return call[1];
}

// ---------------- tests ----------------

describe('AgentGateway.handleConnection', () => {
  it('成功握手后绑定 on("close") / on("message")、挂 state=connected，且暂不 upsertOnline', async () => {
    const { gw, registry, agents } = createGateway();
    const ws = createMockWs();
    const req = createMockReq();

    await gw.handleConnection(ws as any, req as any);

    // 挂 state
    const slot = gw.agentSlots.get(ws as any);
    expect(slot).toBeDefined();
    expect(slot!.state).toBe('connected');
    expect(slot!.licenseId).toBe(101);
    expect(slot!.customerId).toBe(7);

    // 绑定了 close / message
    const eventNames = ws.on.mock.calls.map((c: any[]) => c[0]);
    expect(eventNames).toEqual(expect.arrayContaining(['close', 'message']));

    // 未 upsertOnline（等 hello）
    expect(agents.upsertOnline).not.toHaveBeenCalled();

    // registry.register 在握手期不调（bootTime 还没到，要等 hello）
    expect(registry.register).not.toHaveBeenCalled();

    // 未主动 close
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('signature_invalid → close(1008, "signature invalid")', async () => {
    const license = createMockLicenseService({
      verifyResult: { ok: false, code: PrecheckErrorCode.SIGNATURE_INVALID },
    });
    const { gw, agents } = createGateway({ license });
    const ws = createMockWs();
    await gw.handleConnection(ws as any, createMockReq() as any);

    expect(ws.close).toHaveBeenCalledWith(1008, 'signature invalid');
    expect(agents.upsertOnline).not.toHaveBeenCalled();
  });

  it('license_revoked → close(4003, "license revoked")', async () => {
    const license = createMockLicenseService({
      verifyResult: { ok: false, code: PrecheckErrorCode.LICENSE_REVOKED },
    });
    const { gw } = createGateway({ license });
    const ws = createMockWs();
    await gw.handleConnection(ws as any, createMockReq() as any);

    expect(ws.close).toHaveBeenCalledWith(4003, 'license revoked');
  });

  it('customer_suspended → close(4003, "customer suspended")', async () => {
    const license = createMockLicenseService({
      verifyResult: { ok: false, code: PrecheckErrorCode.CUSTOMER_SUSPENDED },
    });
    const { gw } = createGateway({ license });
    const ws = createMockWs();
    await gw.handleConnection(ws as any, createMockReq() as any);

    expect(ws.close).toHaveBeenCalledWith(4003, 'customer suspended');
  });

  it('缺 X-License-Key header → close(1008, "bad request")', async () => {
    const { gw, license } = createGateway();
    const ws = createMockWs();
    const req = createMockReq({ 'x-license-key': undefined });
    await gw.handleConnection(ws as any, req as any);

    // 缺 header 时甚至不该调到 verifyPrecheckForHandshake
    expect(license.verifyPrecheckForHandshake).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1008, 'bad request');
  });
});

describe('AgentGateway.handleMessage — agent.hello', () => {
  /** 完成握手并拿到 message handler。 */
  async function handshakeAndGetMsgHandler() {
    const env = createGateway();
    const ws = createMockWs();
    const req = createMockReq();
    await env.gw.handleConnection(ws as any, req as any);
    const onMessage = getMessageHandler(ws);
    return { ...env, ws, onMessage };
  }

  function helloFrame(params: Record<string, unknown>, id: number | string = 1) {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'agent.hello',
      params,
    });
  }

  it('合法 hello → upsertOnline 被调；state=hello_received；回 jsonRpcResult', async () => {
    const { gw, onMessage, ws, agents, registry } = await handshakeAndGetMsgHandler();

    const bootTime = Date.now() - 1000;
    await onMessage(
      helloFrame({
        agent_version: '1.0.0',
        host_name: 'host-1',
        os_info: 'Linux 6.1',
        boot_time: bootTime,
      }),
    );

    expect(agents.upsertOnline).toHaveBeenCalledTimes(1);
    const upsertArg = agents.upsertOnline.mock.calls[0][0];
    expect(upsertArg.licenseId).toBe(101);
    expect(upsertArg.customerId).toBe(7);
    expect(upsertArg.agentVersion).toBe('1.0.0');
    expect(upsertArg.hostName).toBe('host-1');
    expect(upsertArg.kernel).toBe('Linux 6.1');
    expect(upsertArg.publicIp).toBe('1.2.3.4');
    expect(upsertArg.bootTime).toBeInstanceOf(Date);
    expect(upsertArg.bootTime.getTime()).toBe(bootTime);

    // state 变更
    expect(gw.agentSlots.get(ws as any)!.state).toBe('hello_received');

    // registry.register 在 hello 阶段调（此时才有 bootTime）
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register.mock.calls[0][0]).toBe(101);
    expect(registry.register.mock.calls[0][1]).toBe(ws);
    expect(registry.register.mock.calls[0][2]).toBe(bootTime);

    // ack
    const reply = firstSent(ws);
    expect(reply.jsonrpc).toBe('2.0');
    expect(reply.id).toBe(1);
    expect(reply.result).toBeDefined();
    expect(reply.result.ok).toBe(true);
    expect(reply.error).toBeUndefined();
  });

  it('hello 再次（state=hello_received）→ -40029，不重复 upsert', async () => {
    const { onMessage, ws, agents } = await handshakeAndGetMsgHandler();

    const now = Date.now();
    await onMessage(
      helloFrame({
        agent_version: '1.0.0',
        host_name: 'h',
        os_info: 'Linux',
        boot_time: now,
      }, 1),
    );
    // 清理上一次 send 记录
    ws.send.mockClear();

    await onMessage(
      helloFrame({
        agent_version: '1.0.0',
        host_name: 'h',
        os_info: 'Linux',
        boot_time: now + 1,
      }, 2),
    );

    expect(agents.upsertOnline).toHaveBeenCalledTimes(1); // 只第一次生效

    const reply = firstSent(ws);
    expect(reply.id).toBe(2);
    expect(reply.error).toBeDefined();
    expect(reply.error.code).toBe(AgentRpcErrorCode.NOT_READY); // -40029
  });

  it('hello bootTime 非 number → -40001', async () => {
    const { onMessage, ws, agents } = await handshakeAndGetMsgHandler();

    await onMessage(
      helloFrame({
        agent_version: '1.0.0',
        host_name: 'h',
        os_info: 'Linux',
        boot_time: 'not-a-number',
      }, 9),
    );

    expect(agents.upsertOnline).not.toHaveBeenCalled();
    const reply = firstSent(ws);
    expect(reply.id).toBe(9);
    expect(reply.error.code).toBe(AgentRpcErrorCode.BAD_REQUEST); // -40001
  });

  it('hello bootTime 超范围（now-11y）→ -40001', async () => {
    const { onMessage, ws, agents } = await handshakeAndGetMsgHandler();

    await onMessage(
      helloFrame({
        agent_version: '1.0.0',
        host_name: 'h',
        os_info: 'Linux',
        boot_time: Date.now() - 11 * 365 * 86_400_000,
      }, 11),
    );

    expect(agents.upsertOnline).not.toHaveBeenCalled();
    const reply = firstSent(ws);
    expect(reply.id).toBe(11);
    expect(reply.error.code).toBe(AgentRpcErrorCode.BAD_REQUEST); // -40001
  });

  it('hello 时 registry 判定 rejected_flapping → -40013 + close(4013) 且不 upsertOnline', async () => {
    const registry = createMockRegistry();
    // 劫持 register 强制返回 flapping 结果（真实场景：同 bootTime 300ms 内重连）
    registry.register.mockReturnValueOnce({ outcome: 'rejected_flapping' });
    const { gw, agents } = createGateway({ registry });
    const ws = createMockWs();
    await gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);

    await onMessage(
      helloFrame(
        {
          agent_version: '1.0.0',
          host_name: 'h',
          os_info: 'Linux',
          boot_time: Date.now(),
        },
        12,
      ),
    );

    expect(agents.upsertOnline).not.toHaveBeenCalled();
    const reply = firstSent(ws);
    expect(reply.id).toBe(12);
    expect(reply.error.code).toBe(AgentRpcErrorCode.FLAPPING); // -40013
    expect(ws.close).toHaveBeenCalledWith(4013, 'flapping');
  });
});

describe('AgentGateway.handleMessage — agent.heartbeat', () => {
  async function handshakeAndHello() {
    const env = createGateway();
    const ws = createMockWs();
    await env.gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);
    // 完成 hello
    await onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.hello',
        params: {
          agent_version: '1.0.0',
          host_name: 'h',
          os_info: 'Linux',
          boot_time: Date.now(),
        },
      }),
    );
    ws.send.mockClear();
    return { ...env, ws, onMessage };
  }

  function hbFrame(id: number | string = 2) {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'agent.heartbeat',
      params: {
        uptime_seconds: 3600,
        cpu_percent: 5.5,
        mem_used_bytes: 1024 * 1024 * 1024,
        mem_total_bytes: 8192 * 1024 * 1024,
        loadavg_1: 0.5,
      },
    });
  }

  it('未 hello 时收到 heartbeat → -40029', async () => {
    const env = createGateway();
    const ws = createMockWs();
    await env.gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);

    await onMessage(hbFrame(5));

    expect(env.agents.updateHeartbeat).not.toHaveBeenCalled();
    const reply = firstSent(ws);
    expect(reply.id).toBe(5);
    expect(reply.error.code).toBe(AgentRpcErrorCode.NOT_READY); // -40029
  });

  it('正常 heartbeat → updateHeartbeat 被调 + jsonRpcResult', async () => {
    const { onMessage, ws, agents } = await handshakeAndHello();

    await onMessage(hbFrame(2));

    expect(agents.updateHeartbeat).toHaveBeenCalledTimes(1);
    const [licenseId, metrics] = agents.updateHeartbeat.mock.calls[0];
    expect(licenseId).toBe(101);
    expect(metrics.uptimeSeconds).toBe(3600);
    expect(metrics.cpuPercent).toBe(5.5);
    expect(metrics.memUsedBytes).toBe(1024 * 1024 * 1024);
    expect(metrics.memTotalBytes).toBe(8192 * 1024 * 1024);
    expect(metrics.loadavg1).toBe(0.5);

    const reply = firstSent(ws);
    expect(reply.id).toBe(2);
    expect(reply.result).toBeDefined();
    expect(reply.error).toBeUndefined();
  });

  it('heartbeat 时 license 已吊销（findActiveByKey 返 null）→ -40003 + close(4003)', async () => {
    const license = createMockLicenseService();
    const { gw, agents } = createGateway({ license });
    const ws = createMockWs();
    await gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);

    // 先完成 hello
    await onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.hello',
        params: {
          agent_version: '1.0.0',
          host_name: 'h',
          os_info: 'Linux',
          boot_time: Date.now(),
        },
      }),
    );
    ws.send.mockClear();

    // 将 findActiveByKey 改为返回 null（license 吊销）
    license.findActiveByKey.mockResolvedValueOnce(null);

    await onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'agent.heartbeat',
        params: {
          uptime_seconds: 1,
          cpu_percent: 1,
          mem_used_bytes: 1,
          mem_total_bytes: 2,
          loadavg_1: 0.1,
        },
      }),
    );

    expect(agents.updateHeartbeat).not.toHaveBeenCalled();
    const reply = firstSent(ws);
    expect(reply.id).toBe(7);
    expect(reply.error.code).toBe(AgentRpcErrorCode.LICENSE_REVOKED); // -40003
    expect(ws.close).toHaveBeenCalledWith(4003, expect.any(String));
  });
});

describe('AgentGateway.handleMessage — misc', () => {
  async function handshake() {
    const env = createGateway();
    const ws = createMockWs();
    await env.gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);
    return { ...env, ws, onMessage };
  }

  it('未知 method → -40001 method_not_found', async () => {
    const { onMessage, ws } = await handshake();
    await onMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'agent.unknown', params: {} }),
    );
    const reply = firstSent(ws);
    expect(reply.id).toBe(3);
    expect(reply.error.code).toBe(AgentRpcErrorCode.BAD_REQUEST); // -40001
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('非法 JSON → -32700 且不 close', async () => {
    const { onMessage, ws } = await handshake();
    await onMessage('not-a-json-at-all{');
    const reply = firstSent(ws);
    expect(reply.error.code).toBe(JsonRpcErrorCode.ParseError); // -32700
    expect(reply.id).toBeNull(); // 解析失败 id 不可知
    expect(ws.close).not.toHaveBeenCalled();
  });
});

describe('AgentGateway — ws.on("close") handler', () => {
  async function handshakeHelloAndGetCloseHandler() {
    const env = createGateway();
    const ws = createMockWs();
    await env.gw.handleConnection(ws as any, createMockReq() as any);
    const onMessage = getMessageHandler(ws);
    await onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.hello',
        params: {
          agent_version: '1.0.0',
          host_name: 'h',
          os_info: 'Linux',
          boot_time: Date.now(),
        },
      }),
    );
    const closeHandler = getCloseHandler(ws);
    return { ...env, ws, closeHandler };
  }

  it('当前 ws 仍在 registry → unregister + markOfflineByLicense 都被调', async () => {
    const { closeHandler, ws, registry, agents } =
      await handshakeHelloAndGetCloseHandler();

    await closeHandler();

    expect(registry.unregister).toHaveBeenCalledWith(101, ws);
    expect(agents.markOfflineByLicense).toHaveBeenCalledWith(101);
  });

  it('registry 里是另一个 ws（旧 ws 被 replaced）→ 不调任何 service', async () => {
    const { closeHandler, ws, registry, agents } =
      await handshakeHelloAndGetCloseHandler();

    // 模拟被替换：直接劫持 get() 返回另一个 ws（而不是走 fake store 真的跑 register+replace）。
    // 这里只测 gateway 对 "get() 返 ws 与自己不同" 的反应，registry 仲裁逻辑由 AgentRegistry 自测保障。
    registry.get.mockReturnValueOnce({ ws: createMockWs(), bootTime: 999 });

    await closeHandler();

    // 不应调用任何 service 清理函数
    expect(registry.unregister).not.toHaveBeenCalled();
    expect(agents.markOfflineByLicense).not.toHaveBeenCalled();

    // 保险：ws 自身不应被修改
    expect(ws).toBeDefined();
  });
});
