import { AgentService } from './agent.service';

/**
 * AgentService 单元测试。
 *
 * 策略：仿 license.service.spec.ts，直接实例化 service + 手工构造 drizzle conn mock。
 * 不使用 Test.createTestingModule、不连真实 DB；覆盖：
 * - upsertOnline 用 insert().onConflictDoUpdate()（原子 upsert，规避 UNIQUE 冲突）
 * - upsertOnline update 分支清零旧 metrics（避免重连显示陈旧数据）
 * - updateHeartbeat 20s 去抖（同窗口只写一次）
 * - markOfflineByLicense 置 offline + 清 debounce
 * - listForCustomer 多行透传
 */
describe('AgentService', () => {
  /**
   * 构造 drizzle conn mock：
   * - insert().values().onConflictDoUpdate() → Promise<void>，记录到 _state.inserts（含 conflict cfg）
   * - update().set().where() → Promise<void>，记录到 _state.updates
   * - update().set().where().returning() → 返回 _state.returningRows 队列头部
   * - select().from().where().limit() → Promise<rows>，rows 由 _state.selectResponses 顺序决定
   */
  function createMockConn() {
    const state = {
      inserts: [] as Array<{ table: unknown; values: any; conflict?: any }>,
      updates: [] as Array<{ table: unknown; set: any; where: any }>,
      selectResponses: [] as any[][],
      selectIndex: 0,
      returningRows: [] as any[][],
      returningIndex: 0,
    };

    const conn: any = {
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((values: any) => {
          const record: { table: unknown; values: any; conflict?: any } = {
            table,
            values,
          };
          state.inserts.push(record);
          return {
            // 对同一个 values() 返回的链尾同时支持 await（不走 conflict）与 .onConflictDoUpdate()
            onConflictDoUpdate: jest.fn((cfg: any) => {
              record.conflict = cfg;
              return Promise.resolve();
            }),
            then: (resolve: any) => resolve(undefined),
          };
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: jest.fn((setValues: any) => ({
          where: jest.fn((whereArg: any) => {
            state.updates.push({ table, set: setValues, where: whereArg });
            // 支持两种链尾：await（无 returning）或 .returning()
            const tail: any = Promise.resolve();
            tail.returning = jest.fn((_cols: any) => {
              const rows = state.returningRows[state.returningIndex++] ?? [];
              return Promise.resolve(rows);
            });
            return tail;
          }),
        })),
      })),
      select: jest.fn((_cols?: any) => ({
        from: jest.fn((_table: unknown) => {
          const rows = state.selectResponses[state.selectIndex++] ?? [];
          const whereObj = {
            limit: jest.fn(() => Promise.resolve(rows)),
            then: (resolve: any) => resolve(rows),
          };
          return {
            where: jest.fn(() => whereObj),
          };
        }),
      })),
      _state: state,
    };
    return conn;
  }

  function createService(conn = createMockConn()) {
    const svc = new AgentService(conn);
    return { svc, conn };
  }

  const LICENSE_ID = 101;
  const CUSTOMER_ID = 7;

  it('upsertOnline 用 insert().onConflictDoUpdate() 原子 upsert（首次握手）', async () => {
    const { svc, conn } = createService();

    await svc.upsertOnline({
      licenseId: LICENSE_ID,
      customerId: CUSTOMER_ID,
      agentVersion: '1.0.0',
      publicIp: '1.2.3.4',
      hostName: 'test-host',
      kernel: 'linux',
      bootTime: new Date(),
    });

    // 不论首次还是重连，实现都走 insert + onConflictDoUpdate 单语句
    expect(conn._state.inserts).toHaveLength(1);
    expect(conn._state.updates).toHaveLength(0);

    const rec = conn._state.inserts[0];
    // values 分支（首次 PG 走这里）
    expect(rec.values.status).toBe('online');
    expect(rec.values.agentVersion).toBe('1.0.0');
    expect(rec.values.licenseId).toBe(LICENSE_ID);
    expect(rec.values.customerId).toBe(CUSTOMER_ID);
    expect(rec.values.connectedAt).toBeInstanceOf(Date);
    expect(rec.values.lastHeartbeatAt).toBeInstanceOf(Date);

    // onConflictDoUpdate 一定要传 target（UNIQUE(license_id)）
    expect(rec.conflict).toBeDefined();
    expect(rec.conflict.target).toBeDefined();
    expect(rec.conflict.set).toBeDefined();
  });

  it('upsertOnline 的 onConflictDoUpdate set 清零旧 metrics（重连不展示陈旧数据）', async () => {
    const { svc, conn } = createService();

    await svc.upsertOnline({
      licenseId: LICENSE_ID,
      customerId: CUSTOMER_ID,
      agentVersion: '1.0.1',
      publicIp: '1.2.3.4',
      hostName: 'test-host',
      kernel: 'linux',
      bootTime: new Date(),
    });

    const set = conn._state.inserts[0].conflict.set;
    // 翻回 online + 刷新握手字段
    expect(set.status).toBe('online');
    expect(set.agentVersion).toBe('1.0.1');
    expect(set.connectedAt).toBeInstanceOf(Date);
    expect(set.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(set.updatedAt).toBeInstanceOf(Date);
    // 5 个 metrics 字段显式置 null，等下一次心跳刷新
    expect(set.uptimeSeconds).toBeNull();
    expect(set.cpuPercent).toBeNull();
    expect(set.memUsedBytes).toBeNull();
    expect(set.memTotalBytes).toBeNull();
    expect(set.loadavg1).toBeNull();
  });

  it('updateHeartbeat 20s 窗口内多次调用只写 DB 一次（去抖）', async () => {
    const { svc, conn } = createService();
    const metrics = {
      uptimeSeconds: 100,
      cpuPercent: 1.5,
      memUsedBytes: 1,
      memTotalBytes: 2,
      loadavg1: 0.1,
    };

    await svc.updateHeartbeat(LICENSE_ID, metrics);
    await svc.updateHeartbeat(LICENSE_ID, {
      ...metrics,
      uptimeSeconds: 101,
      cpuPercent: 1.6,
    });

    // 第 1 次应穿透写 DB；第 2 次在 20s 窗口内直接 return
    expect(conn._state.updates).toHaveLength(1);
    const setArg = conn._state.updates[0].set;
    // cpuPercent / loadavg1 要 toFixed(2) 转 string
    expect(setArg.cpuPercent).toBe('1.50');
    expect(setArg.loadavg1).toBe('0.10');
    expect(setArg.uptimeSeconds).toBe(100);
  });

  // ---- B3-T4：bot 字段落库 ----

  it('B3：updateHeartbeat 不带 bot → DB set 不包含 bot_* 字段（保留 DB 现值）', async () => {
    const { svc, conn } = createService();
    await svc.updateHeartbeat(LICENSE_ID, {
      uptimeSeconds: 100,
      cpuPercent: 1.5,
      memUsedBytes: 1,
      memTotalBytes: 2,
      loadavg1: 0.1,
    });
    const set = conn._state.updates[0].set;
    expect(set).not.toHaveProperty('botStatus');
    expect(set).not.toHaveProperty('botPid');
    expect(set).not.toHaveProperty('botUptimeSeconds');
    expect(set).not.toHaveProperty('botConfigVersion');
    expect(set).not.toHaveProperty('botLastTgPollAt');
    expect(set).not.toHaveProperty('botLastError');
  });

  it('B3：updateHeartbeat 带完整 bot → DB set 包含全部 6 个 bot_* 字段', async () => {
    const { svc, conn } = createService();
    const pollAt = new Date('2026-05-05T12:00:00.000Z');
    await svc.updateHeartbeat(
      LICENSE_ID,
      {
        uptimeSeconds: 100,
        cpuPercent: 1.5,
        memUsedBytes: 1,
        memTotalBytes: 2,
        loadavg1: 0.1,
      },
      {
        status: 'running',
        pid: 12345,
        uptimeSeconds: 600,
        configVersion: 'cfg-v7',
        lastTgPollAt: pollAt,
        lastError: 'some err',
      },
    );
    const set = conn._state.updates[0].set;
    expect(set.botStatus).toBe('running');
    expect(set.botPid).toBe(12345);
    expect(set.botUptimeSeconds).toBe(600);
    expect(set.botConfigVersion).toBe('cfg-v7');
    expect(set.botLastTgPollAt).toBe(pollAt);
    expect(set.botLastError).toBe('some err');
  });

  it('B3：updateHeartbeat 带部分 bot（status 存在、其它缺失）→ 缺失字段写 null（覆盖旧值）', async () => {
    const { svc, conn } = createService();
    await svc.updateHeartbeat(
      LICENSE_ID,
      {
        uptimeSeconds: 100,
        cpuPercent: 1.5,
        memUsedBytes: 1,
        memTotalBytes: 2,
        loadavg1: 0.1,
      },
      { status: 'stopped' },
    );
    const set = conn._state.updates[0].set;
    expect(set.botStatus).toBe('stopped');
    // 语义：bot 对象给了（agent 版本 B3+），该清掉的旧值清掉
    expect(set.botPid).toBeNull();
    expect(set.botUptimeSeconds).toBeNull();
    expect(set.botConfigVersion).toBeNull();
    expect(set.botLastTgPollAt).toBeNull();
    expect(set.botLastError).toBeNull();
  });

  it('markOfflineByLicense 置 offline 并清理 debounce map', async () => {
    const { svc, conn } = createService();
    // 先种一次心跳让 debounce map 有条目
    await svc.updateHeartbeat(LICENSE_ID, {
      uptimeSeconds: 10,
      cpuPercent: 1,
      memUsedBytes: 1,
      memTotalBytes: 2,
      loadavg1: 0.1,
    });
    expect(conn._state.updates).toHaveLength(1); // 心跳那次

    await svc.markOfflineByLicense(LICENSE_ID);

    // 这次又加一条 offline update
    expect(conn._state.updates).toHaveLength(2);
    expect(conn._state.updates[1].set.status).toBe('offline');
    expect(conn._state.updates[1].set.updatedAt).toBeInstanceOf(Date);

    // debounce map 的条目应被删除：下一次心跳会立即穿透（不在窗口内）
    await svc.updateHeartbeat(LICENSE_ID, {
      uptimeSeconds: 11,
      cpuPercent: 1,
      memUsedBytes: 1,
      memTotalBytes: 2,
      loadavg1: 0.1,
    });
    expect(conn._state.updates).toHaveLength(3);
  });

  it('listForCustomer 返回 conn.select 给出的所有行', async () => {
    const { svc, conn } = createService();
    const rows = [
      { id: 1, licenseId: 101, customerId: CUSTOMER_ID, status: 'online' },
      { id: 2, licenseId: 102, customerId: CUSTOMER_ID, status: 'offline' },
      { id: 3, licenseId: 103, customerId: CUSTOMER_ID, status: 'never_seen' },
    ];
    conn._state.selectResponses.push(rows);

    const list = await svc.listForCustomer(CUSTOMER_ID);
    expect(list).toHaveLength(3);
    expect(list[0].licenseId).toBe(101);
    expect(list[2].status).toBe('never_seen');
  });
});
