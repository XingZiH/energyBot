import { AgentRegistry } from './agent.registry';
import { WebSocket } from 'ws';

/** 构造一个最小 mock，只实现 close() */
function mockWs(): WebSocket {
  return { close: jest.fn(), readyState: 1 } as unknown as WebSocket;
}

describe('AgentRegistry', () => {
  let reg: AgentRegistry;

  beforeEach(() => { reg = new AgentRegistry(); });

  it('首次注册 licenseId → new', () => {
    const ws = mockWs();
    const r = reg.register(1, ws, 1000);
    expect(r.outcome).toBe('new');
  });

  it('同 bootTime 300ms 内第二次握手 → rejected（抗抖动）', () => {
    const w1 = mockWs();
    reg.register(1, w1, 1000);
    const w2 = mockWs();
    const r = reg.register(1, w2, 1000);   // 同 bootTime
    expect(r.outcome).toBe('rejected_flapping');
    expect(w2.close).not.toHaveBeenCalled();  // 由 gateway 发 close，不在 registry
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
    reg.register(1, w2, 2000);   // w1 被踢

    reg.unregister(1, w1);       // w1 的回调迟到
    expect(reg.has(1)).toBe(true);  // 仍持有 w2

    reg.unregister(1, w2);
    expect(reg.has(1)).toBe(false);
  });

  it('touchHeartbeat 更新 lastHb', () => {
    jest.useFakeTimers();
    try {
      const w1 = mockWs();
      reg.register(1, w1, 1000);
      const before = reg.get(1)!.lastHb;
      jest.advanceTimersByTime(100);
      reg.touchHeartbeat(1);
      expect(reg.get(1)!.lastHb).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });
});
