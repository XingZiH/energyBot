import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { MyBotActionService } from './my-bot-action.service';

/**
 * MyBotActionService 单元测试。
 *
 * Mock 策略：
 * - conn 堆叠 selectResponses：第 1 次查 user.customerId，第 2 次查 license ownership
 * - registry 只需 mock sendToAgent
 *
 * 覆盖路径：
 * - 下发成功 → registry.sendToAgent 被正确调用
 * - user 不存在 → NotFoundException('用户不存在')
 * - user.customerId === null → NotFoundException('当前账号未绑定客户')
 * - license 不属于 customer（第 2 次 select 空）→ ForbiddenException（非 404，防枚举）
 * - registry 返 false → ServiceUnavailableException
 * - 三个方法 (start/stop/reload) 的 method 字符串分别对应 bot.start/bot.stop/bot.reload
 */
describe('MyBotActionService', () => {
  function createMockConn() {
    const state = {
      selectResponses: [] as any[][],
      selectIndex: 0,
    };
    const buildSelectChain = (rows: any) => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(rows)),
        })),
      })),
    });
    const conn: any = {
      select: jest.fn(() => {
        const rows = state.selectResponses[state.selectIndex++] ?? [];
        return buildSelectChain(rows);
      }),
      _state: state,
    };
    return conn;
  }

  function createService() {
    const conn = createMockConn();
    const registry = { sendToAgent: jest.fn() };
    const svc = new MyBotActionService(conn, registry as any);
    return { svc, conn, registry };
  }

  // ---------- start 路径（主快乐径 + 错误径） ----------

  it('start 成功：user 绑客户 + license 属己 + registry.sendToAgent 返 true → 不抛', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [
      [{ customerId: 3 }], // user
      [{ id: 42 }], // license ownership
    ];
    registry.sendToAgent.mockReturnValue(true);

    await expect(svc.start(100, 42)).resolves.toBeUndefined();

    expect(registry.sendToAgent).toHaveBeenCalledTimes(1);
    expect(registry.sendToAgent).toHaveBeenCalledWith(42, 'bot.start');
  });

  it('stop → registry 收到 method=bot.stop', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [[{ customerId: 3 }], [{ id: 42 }]];
    registry.sendToAgent.mockReturnValue(true);

    await svc.stop(100, 42);
    expect(registry.sendToAgent).toHaveBeenCalledWith(42, 'bot.stop');
  });

  it('reload → registry 收到 method=bot.reload', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [[{ customerId: 3 }], [{ id: 42 }]];
    registry.sendToAgent.mockReturnValue(true);

    await svc.reload(100, 42);
    expect(registry.sendToAgent).toHaveBeenCalledWith(42, 'bot.reload');
  });

  // ---------- 错误径 ----------

  it('user 不存在 → NotFoundException("用户不存在")', async () => {
    const { svc, conn, registry } = createService();
    // 第二次断言会再调一次 → 堆叠两组都是空 user
    conn._state.selectResponses = [[], []];

    await expect(svc.start(100, 42)).rejects.toThrow(NotFoundException);
    await expect(svc.start(100, 42)).rejects.toThrow('用户不存在');
    expect(registry.sendToAgent).not.toHaveBeenCalled();
  });

  it('user.customerId === null → NotFoundException("当前账号未绑定客户")', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [
      [{ customerId: null }],
      [{ customerId: null }],
    ];

    await expect(svc.start(100, 42)).rejects.toThrow('当前账号未绑定客户');
    expect(registry.sendToAgent).not.toHaveBeenCalled();
  });

  it('license 不属于 customer（ownership 查空） → ForbiddenException（非 404 防枚举）', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [
      [{ customerId: 3 }],
      [], // license ownership 查空
      [{ customerId: 3 }],
      [], // 第二次断言重放
    ];

    await expect(svc.start(100, 42)).rejects.toThrow(ForbiddenException);
    await expect(svc.start(100, 42)).rejects.toThrow('无权操作该 license');
    expect(registry.sendToAgent).not.toHaveBeenCalled();
  });

  it('registry.sendToAgent 返 false（agent 离线） → ServiceUnavailableException', async () => {
    const { svc, conn, registry } = createService();
    conn._state.selectResponses = [
      [{ customerId: 3 }],
      [{ id: 42 }],
      [{ customerId: 3 }],
      [{ id: 42 }],
    ];
    registry.sendToAgent.mockReturnValue(false);

    await expect(svc.start(100, 42)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(svc.start(100, 42)).rejects.toThrow(
      'agent 不在线，请稍后重试',
    );
  });
});
