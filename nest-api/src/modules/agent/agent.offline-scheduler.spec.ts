import { AgentOfflineScheduler } from './agent.offline-scheduler';
import type { AgentService } from './agent.service';
import type { AgentRegistry, AgentConn } from './agent.registry';
import { WebSocket } from 'ws';

/**
 * AgentOfflineScheduler 单元测试。
 *
 * 风格仿 agent.service.spec.ts / agent.registry.spec.ts：
 * 直接实例化 + 手工 mock，不走 Nest DI，不使用 jest.mock。
 *
 * 覆盖：
 * - 无 stale：只调 markStaleAsOffline，不碰 registry / ws
 * - 2 个 stale 全在 registry：逐个 terminate + unregister，参数正确
 * - stale 但 registry 无槽位：跳过（DB 已清，内存无遗留）
 * - ws.terminate() 抛错：隔离，不影响其他 licenseId；当前 licenseId 仍调 unregister（防 Map 泄漏）
 * - 调 markStaleAsOffline 时传入 OFFLINE_THRESHOLD_MS = 90_000
 */
describe('AgentOfflineScheduler', () => {
  function createMockAgents(): jest.Mocked<
    Pick<AgentService, 'markStaleAsOffline'>
  > {
    return {
      markStaleAsOffline: jest.fn(),
    } as unknown as jest.Mocked<Pick<AgentService, 'markStaleAsOffline'>>;
  }

  function createMockRegistry(): jest.Mocked<
    Pick<AgentRegistry, 'get' | 'unregister'>
  > {
    return {
      get: jest.fn(),
      unregister: jest.fn(),
    } as unknown as jest.Mocked<Pick<AgentRegistry, 'get' | 'unregister'>>;
  }

  /** 最小 ws mock，仅实现 terminate（scheduler 关连接用 terminate 粗暴切断）。 */
  function createMockWs(): WebSocket {
    return { terminate: jest.fn() } as unknown as WebSocket;
  }

  function createSlot(ws: WebSocket, bootTime: number): AgentConn {
    return { ws, bootTime, lastHb: 0, connectedAt: 0 };
  }

  function createScheduler(
    agents = createMockAgents(),
    registry = createMockRegistry(),
  ) {
    const sched = new AgentOfflineScheduler(
      agents as unknown as AgentService,
      registry as unknown as AgentRegistry,
    );
    return { sched, agents, registry };
  }

  it('无 stale agent：仅调 markStaleAsOffline(90_000)，registry / ws 不被碰', async () => {
    const { sched, agents, registry } = createScheduler();
    agents.markStaleAsOffline.mockResolvedValueOnce([]);

    await sched.scan();

    expect(agents.markStaleAsOffline).toHaveBeenCalledTimes(1);
    expect(agents.markStaleAsOffline).toHaveBeenCalledWith(90_000);
    expect(agents.markStaleAsOffline).toHaveBeenCalledWith(
      AgentOfflineScheduler.OFFLINE_THRESHOLD_MS,
    );
    expect(registry.get).not.toHaveBeenCalled();
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('2 个 stale 且都在 registry：逐个 terminate 并 unregister，参数正确', async () => {
    const { sched, agents, registry } = createScheduler();
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    agents.markStaleAsOffline.mockResolvedValueOnce([1, 2]);
    registry.get.mockImplementation((licenseId: number) => {
      if (licenseId === 1) return createSlot(ws1, 100);
      if (licenseId === 2) return createSlot(ws2, 200);
      return undefined;
    });

    await sched.scan();

    expect(ws1.terminate).toHaveBeenCalledTimes(1);
    expect(ws2.terminate).toHaveBeenCalledTimes(1);
    expect(registry.unregister).toHaveBeenCalledTimes(2);
    // 顺序断言：1 先于 2（for-of 遍历 stale 数组的自然顺序）
    expect(registry.unregister).toHaveBeenNthCalledWith(1, 1, ws1);
    expect(registry.unregister).toHaveBeenNthCalledWith(2, 2, ws2);
  });

  it('stale 但 registry 无槽位：跳过（DB 已清，无遗留）', async () => {
    const { sched, agents, registry } = createScheduler();
    agents.markStaleAsOffline.mockResolvedValueOnce([3]);
    registry.get.mockReturnValueOnce(undefined);

    await expect(sched.scan()).resolves.toBeUndefined();

    expect(registry.get).toHaveBeenCalledWith(3);
    expect(registry.unregister).not.toHaveBeenCalled();
  });

  it('ws.terminate 抛错：隔离不影响其他 licenseId，且当前 licenseId 仍调 unregister（防 Map 泄漏）', async () => {
    const { sched, agents, registry } = createScheduler();
    const ws4 = createMockWs();
    const ws5 = createMockWs();
    (ws4.terminate as jest.Mock).mockImplementation(() => {
      throw new Error('EPIPE');
    });
    agents.markStaleAsOffline.mockResolvedValueOnce([4, 5]);
    registry.get.mockImplementation((licenseId: number) => {
      if (licenseId === 4) return createSlot(ws4, 400);
      if (licenseId === 5) return createSlot(ws5, 500);
      return undefined;
    });

    await expect(sched.scan()).resolves.toBeUndefined();

    // license 4 terminate 抛了；5 依然执行
    expect(ws4.terminate).toHaveBeenCalledTimes(1);
    expect(ws5.terminate).toHaveBeenCalledTimes(1);
    // 即使 4 的 terminate 抛错，unregister(4, ws4) 仍要调，防 Map 泄漏
    expect(registry.unregister).toHaveBeenCalledWith(4, ws4);
    expect(registry.unregister).toHaveBeenCalledWith(5, ws5);
    expect(registry.unregister).toHaveBeenCalledTimes(2);
  });

  it('常量 OFFLINE_THRESHOLD_MS === 90_000 并确实作为参数传入', async () => {
    const { sched, agents } = createScheduler();
    agents.markStaleAsOffline.mockResolvedValueOnce([]);

    expect(AgentOfflineScheduler.OFFLINE_THRESHOLD_MS).toBe(90_000);
    await sched.scan();
    expect(agents.markStaleAsOffline).toHaveBeenCalledWith(90_000);
  });
});
