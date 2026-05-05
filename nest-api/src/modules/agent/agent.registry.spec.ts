import { AgentRegistry } from './agent.registry';
import { WebSocket } from 'ws';

/** 构造一个最小 mock，只实现 close()/send()/readyState */
function mockWs(readyState = 1): WebSocket {
  return {
    close: jest.fn(),
    send: jest.fn(),
    readyState,
  } as unknown as WebSocket;
}

describe('AgentRegistry', () => {
  let reg: AgentRegistry;

  beforeEach(() => {
    reg = new AgentRegistry();
  });

  it('首次注册 licenseId → new', () => {
    const ws = mockWs();
    const r = reg.register(1, ws, 1000);
    expect(r.outcome).toBe('new');
  });

  it('同 bootTime 300ms 内第二次握手 → rejected（抗抖动）', () => {
    const w1 = mockWs();
    reg.register(1, w1, 1000);
    const w2 = mockWs();
    const r = reg.register(1, w2, 1000); // 同 bootTime
    expect(r.outcome).toBe('rejected_flapping');
    expect(w2.close).not.toHaveBeenCalled(); // 由 gateway 发 close，不在 registry
  });

  it('不同 bootTime → replaced（老的 close 4001）', () => {
    const w1 = mockWs();
    reg.register(1, w1, 1000);
    const w2 = mockWs();
    const r = reg.register(1, w2, 2000);
    expect(r.outcome).toBe('replaced');
    expect(w1.close).toHaveBeenCalledWith(4001, expect.any(String));
  });

  it('unregister 只对当前 ws 生效（旧 ws 调 unregister 不清状态）', () => {
    const w1 = mockWs();
    reg.register(1, w1, 1000);
    const w2 = mockWs();
    reg.register(1, w2, 2000); // w1 被踢

    reg.unregister(1, w1); // w1 的回调迟到
    expect(reg.has(1)).toBe(true); // 仍持有 w2

    reg.unregister(1, w2);
    expect(reg.has(1)).toBe(false);
  });

  it('touchHeartbeat 更新 lastHb', () => {
    jest.useFakeTimers();
    try {
      const w1 = mockWs();
      reg.register(1, w1, 1000);
      const before = reg.get(1).lastHb;
      jest.advanceTimersByTime(100);
      reg.touchHeartbeat(1);
      expect(reg.get(1).lastHb).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('sendToAgent (B3-T5 下行 notification)', () => {
    it('licenseId 在线 → ws.send 写出 JSON-RPC notification 帧（无 id）', () => {
      const ws = mockWs();
      reg.register(1, ws, 1000);
      const ok = reg.sendToAgent(1, 'bot.start', { config_version: 7 });
      expect(ok).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(1);
      const raw = (ws.send as jest.Mock).mock.calls[0][0] as string;
      const frame = JSON.parse(raw);
      expect(frame).toEqual({
        jsonrpc: '2.0',
        method: 'bot.start',
        params: { config_version: 7 },
      });
      expect(frame.id).toBeUndefined();
    });

    it('params 省略 → 帧不含 params 字段', () => {
      const ws = mockWs();
      reg.register(1, ws, 1000);
      reg.sendToAgent(1, 'bot.stop');
      const raw = (ws.send as jest.Mock).mock.calls[0][0] as string;
      const frame = JSON.parse(raw);
      expect(frame).toEqual({ jsonrpc: '2.0', method: 'bot.stop' });
      expect('params' in frame).toBe(false);
    });

    it('licenseId 不在线 → 返 false，不抛', () => {
      const ok = reg.sendToAgent(999, 'bot.start');
      expect(ok).toBe(false);
    });

    it('ws 非 OPEN（readyState !== 1） → 返 false，不 send', () => {
      const ws = mockWs(3); // CLOSED
      reg.register(1, ws, 1000);
      const ok = reg.sendToAgent(1, 'bot.start');
      expect(ok).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('ws.send 抛异常 → 返 false，不 bubble', () => {
      const ws = mockWs();
      (ws.send as jest.Mock).mockImplementation(() => {
        throw new Error('broken pipe');
      });
      reg.register(1, ws, 1000);
      const ok = reg.sendToAgent(1, 'bot.reload', { config_version: 3 });
      expect(ok).toBe(false);
    });
  });
});
