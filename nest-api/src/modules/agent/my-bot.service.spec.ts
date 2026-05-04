import { NotFoundException } from '@nestjs/common';
import { MyBotService } from './my-bot.service';

/**
 * MyBotService 单元测试。
 *
 * Mock 策略仿 my-license.service.spec.ts：
 * - conn 是带可堆叠 selectResponses 的 chainable mock
 * - agentService 只需 mock listForCustomer
 *
 * 关键断言：
 * - userId → customerId 反查路径
 * - admin（customerId === null）抛 NotFoundException 且 message 字面量一字不差
 * - 空 agents 数组（customer 存在但无 agents）返回 []，不抛 404
 * - Date → ISO string 转换与 null 兼容
 * - customerId / deletedAt 不暴露在 view
 */
describe('MyBotService', () => {
  function createMockConn() {
    const state = {
      selectResponses: [] as any[][],
      selectIndex: 0,
      lastWhereArgs: [] as any[],
    };
    const buildSelectChain = (rows: any) => ({
      from: jest.fn(() => ({
        where: jest.fn((arg: any) => {
          state.lastWhereArgs.push(arg);
          return {
            limit: jest.fn(() => Promise.resolve(rows)),
          };
        }),
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
    const agentService = {
      listForCustomer: jest.fn(),
    };
    const svc = new MyBotService(conn, agentService as any);
    return { svc, conn, agentService };
  }

  function makeAgentRow(overrides: Partial<any> = {}): any {
    return {
      id: 1,
      licenseId: 101,
      customerId: 3,
      status: 'online',
      agentVersion: '1.0.0',
      publicIp: '1.2.3.4',
      hostName: 'host-a',
      kernel: 'Linux',
      bootTime: new Date('2026-05-01T00:00:00Z'),
      connectedAt: new Date('2026-05-02T00:00:00Z'),
      lastHeartbeatAt: new Date('2026-05-03T00:00:00Z'),
      uptimeSeconds: 3600,
      cpuPercent: '12.34',
      memUsedBytes: 1024,
      memTotalBytes: 4096,
      loadavg1: '0.50',
      createdAt: new Date('2026-04-01T00:00:00Z'),
      updatedAt: new Date('2026-05-03T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    };
  }

  it('普通用户：反查 customerId 并返回 agents view 数组', async () => {
    const { svc, conn, agentService } = createService();
    conn._state.selectResponses.push([{ userId: 1, customerId: 3 }]);
    agentService.listForCustomer.mockResolvedValue([
      makeAgentRow({ id: 1, licenseId: 101 }),
      makeAgentRow({ id: 2, licenseId: 102, status: 'offline' }),
    ]);

    const views = await svc.findByUserId(1);

    expect(agentService.listForCustomer).toHaveBeenCalledWith(3);
    expect(views).toHaveLength(2);
    expect(views[0].id).toBe(1);
    expect(views[0].licenseId).toBe(101);
    expect(views[0].lastHeartbeatAt).toBe('2026-05-03T00:00:00.000Z');
    expect(views[1].status).toBe('offline');
  });

  it('admin 账号（customerId=null）抛 NotFoundException 且 message 为 "当前账号未绑定客户"', async () => {
    const { svc, conn } = createService();
    // 两次断言 → 两次调用 findByUserId → 需要两份 mock response
    conn._state.selectResponses.push([{ userId: 1, customerId: null }]);
    conn._state.selectResponses.push([{ userId: 1, customerId: null }]);

    await expect(svc.findByUserId(1)).rejects.toThrow(NotFoundException);
    await expect(svc.findByUserId(1)).rejects.toThrow('当前账号未绑定客户');
  });

  it('userId 查不到（userTable 返 []）抛 NotFoundException', async () => {
    const { svc, conn } = createService();
    conn._state.selectResponses.push([]);
    // 第二次调用 findByUserId 时 selectIndex++ 会再拿一个，补一个空数组
    conn._state.selectResponses.push([]);

    await expect(svc.findByUserId(99)).rejects.toThrow(NotFoundException);
  });

  it('customer 存在但 agents 为空 → 返回 []（不抛 404）', async () => {
    const { svc, conn, agentService } = createService();
    conn._state.selectResponses.push([{ userId: 1, customerId: 3 }]);
    agentService.listForCustomer.mockResolvedValue([]);

    const views = await svc.findByUserId(1);

    expect(views).toEqual([]);
    expect(agentService.listForCustomer).toHaveBeenCalledWith(3);
  });

  it('Date 字段转 ISO；null 原样保留 null', async () => {
    const { svc, conn, agentService } = createService();
    conn._state.selectResponses.push([{ userId: 1, customerId: 3 }]);
    agentService.listForCustomer.mockResolvedValue([
      makeAgentRow({
        lastHeartbeatAt: new Date('2026-05-04T00:00:00Z'),
        bootTime: null,
      }),
    ]);

    const [view] = await svc.findByUserId(1);
    expect(view.lastHeartbeatAt).toBe('2026-05-04T00:00:00.000Z');
    expect(view.bootTime).toBeNull();
  });

  it('view 不暴露 customerId / deletedAt', async () => {
    const { svc, conn, agentService } = createService();
    conn._state.selectResponses.push([{ userId: 1, customerId: 3 }]);
    agentService.listForCustomer.mockResolvedValue([makeAgentRow()]);

    const [view] = await svc.findByUserId(1);
    const keys = Object.keys(view);
    expect(keys).not.toContain('customerId');
    expect(keys).not.toContain('deletedAt');
  });

  it('userId 参数原样作为 where eq 条件传入', async () => {
    const { svc, conn, agentService } = createService();
    conn._state.selectResponses.push([{ userId: 7, customerId: 3 }]);
    agentService.listForCustomer.mockResolvedValue([]);

    await svc.findByUserId(7);

    // drizzle eq() 返回 SQL 对象，其 queryChunks 里会带 Param(7)。
    // 直接 JSON.stringify 会撞循环引用（PgInteger.table -> PgTable -> id 回指），
    // 所以递归找 Param.value === 7 即可。
    expect(conn._state.lastWhereArgs).toHaveLength(1);
    const whereArg = conn._state.lastWhereArgs[0];
    expect(whereArg).toBeDefined();

    const findParamValue = (obj: any, seen = new Set<any>()): any[] => {
      if (obj == null || typeof obj !== 'object' || seen.has(obj)) return [];
      seen.add(obj);
      const found: any[] = [];
      // drizzle 的 Param 对象带 .value 属性
      if (
        Object.prototype.hasOwnProperty.call(obj, 'value') &&
        typeof obj.value === 'number'
      ) {
        found.push(obj.value);
      }
      for (const k of Object.keys(obj)) {
        if (k === 'table') continue; // 跳过反向引用
        found.push(...findParamValue(obj[k], seen));
      }
      return found;
    };
    const values = findParamValue(whereArg);
    expect(values).toContain(7);
  });
});
