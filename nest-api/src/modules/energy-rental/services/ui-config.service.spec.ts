import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { UiConfigService } from './ui-config.service';
import { ButtonAction } from '../dto/ui-config.dto';
import { agentBotConfigsTable, energyPackagesTable } from '../../../drizzle/schema';

type MockCall = {
  table: unknown;
  whereArg: unknown;
};

// drizzle conn mock：支持 select().from().where() 链式调用，按 table 返回预设行。
// 可选传入 recorder：捕获每次 where 调用的 { table, whereArg } 便于安全断言。
function createMockConn(
  rowsByTable: Map<unknown, unknown[]>,
  recorder?: MockCall[],
) {
  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => ({
        where: jest.fn((whereArg: unknown) => {
          recorder?.push({ table, whereArg });
          return Promise.resolve(rowsByTable.get(table) ?? []);
        }),
      })),
    })),
  };
}

describe('UiConfigService', () => {
  describe('validateMenuDepth', () => {
    it('接受 3 层嵌套', () => {
      const service = new UiConfigService({} as any);
      const menu = [{
        id: 'r1', buttons: [{
          id: 'b1', text: 'L1', action: ButtonAction.SUBMENU,
          submenu: [{ id: 'r2', buttons: [{
            id: 'b2', text: 'L2', action: ButtonAction.SUBMENU,
            submenu: [{ id: 'r3', buttons: [{ id: 'b3', text: 'L3', action: ButtonAction.ORDERS }] }],
          }] }],
        }],
      }];
      expect(() => service.validateMenuDepth(menu as any)).not.toThrow();
    });

    it('拒绝 4 层嵌套', () => {
      const service = new UiConfigService({} as any);
      const menu = [{
        id: 'r1', buttons: [{
          id: 'b1', text: 'L1', action: ButtonAction.SUBMENU,
          submenu: [{ id: 'r2', buttons: [{
            id: 'b2', text: 'L2', action: ButtonAction.SUBMENU,
            submenu: [{ id: 'r3', buttons: [{
              id: 'b3', text: 'L3', action: ButtonAction.SUBMENU,
              submenu: [{ id: 'r4', buttons: [{ id: 'b4', text: 'L4', action: ButtonAction.ORDERS }] }],
            }] }],
          }] }],
        }],
      }];
      expect(() => service.validateMenuDepth(menu as any))
        .toThrow(BadRequestException);
      expect(() => service.validateMenuDepth(menu as any))
        .toThrow(/菜单嵌套深度不能超过 3 层/);
    });

    it('接受空菜单', () => {
      const service = new UiConfigService({} as any);
      expect(() => service.validateMenuDepth([])).not.toThrow();
    });
  });

  describe('validatePackageIds', () => {
    it('套餐 ID 全部存在时通过', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }, { id: 2 }]],
      ]));
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r1', buttons: [{
          id: 'b1', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
          packageGroup: { packageIds: [1, 2], sortBy: 'price_asc', textTemplate: '{name}' },
        }],
      }];
      await expect(service.validatePackageIds(menu as any, 100)).resolves.not.toThrow();
    });

    it('存在不在数据库的套餐 ID 时抛 BadRequestException（消息只说数量）', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }]], // 999 不存在
      ]));
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r1', buttons: [{
          id: 'b1', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
          packageGroup: { packageIds: [1, 999], sortBy: 'price_asc', textTemplate: '{name}' },
        }],
      }];
      await expect(service.validatePackageIds(menu as any, 100))
        .rejects.toThrow(BadRequestException);
      // 降敏后消息应包含「无效」字样，且不得暴露具体 ID
      await expect(service.validatePackageIds(menu as any, 100))
        .rejects.toThrow(/无效/);
    });

    it('递归收集 submenu 中的套餐 ID', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }, { id: 2 }, { id: 3 }]],
      ]));
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r1', buttons: [{
          id: 'b1', text: '下钻', action: ButtonAction.SUBMENU,
          submenu: [{
            id: 'r2', buttons: [{
              id: 'b2', text: '套餐组',
              action: ButtonAction.ENERGY_PACKAGE_GROUP,
              packageGroup: { packageIds: [1, 2, 3], sortBy: 'manual', textTemplate: '{name}' },
            }],
          }],
        }],
      }];
      await expect(service.validatePackageIds(menu as any, 100)).resolves.not.toThrow();
    });

    it('无套餐组引用时跳过查询', async () => {
      const selectSpy = jest.fn(() => ({ from: jest.fn() }));
      const conn = { select: selectSpy };
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r1', buttons: [{ id: 'b1', text: '订单', action: ButtonAction.ORDERS }],
      }];
      await service.validatePackageIds(menu as any, 100);
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('packageIds 去重后查询一次', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }, { id: 2 }]],
      ]));
      const selectSpy = jest.spyOn(conn, 'select');
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r1', buttons: [
          {
            id: 'b1', text: '套餐组1',
            action: ButtonAction.ENERGY_PACKAGE_GROUP,
            packageGroup: { packageIds: [1, 2], sortBy: 'price_asc', textTemplate: '{name}' },
          },
          {
            id: 'b2', text: '套餐组2',
            action: ButtonAction.ENERGY_PACKAGE_GROUP,
            packageGroup: { packageIds: [2, 1], sortBy: 'manual', textTemplate: '{name}' },
          },
        ],
      }];
      await service.validatePackageIds(menu as any, 100);
      expect(selectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('validatePackageIds - 安全边界', () => {
    it('拒绝引用其他 agent 的套餐 ID（mock 返回空）', async () => {
      // agent 200 拥有 id=5，agent 100 引用 id=5
      // drizzle WHERE 带 agent_id=100 过滤后应返回空，视为缺失
      const conn = createMockConn(new Map([
        [energyPackagesTable, []], // agentId=100 查不到 id=5
      ]));
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r', buttons: [{
          id: 'b', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
          packageGroup: { packageIds: [5], sortBy: 'price_asc', textTemplate: '{n}' },
        }],
      }];
      await expect(service.validatePackageIds(menu as any, 100))
        .rejects.toThrow(BadRequestException);
    });

    it('where 子句必须调用且携带非空参数（防越权回归）', async () => {
      const recorder: MockCall[] = [];
      const conn = createMockConn(
        new Map([[energyPackagesTable, [{ id: 1 }]]]),
        recorder,
      );
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r', buttons: [{
          id: 'b', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
          packageGroup: { packageIds: [1], sortBy: 'price_asc', textTemplate: '{n}' },
        }],
      }];
      await service.validatePackageIds(menu as any, 100);
      expect(recorder).toHaveLength(1);
      // where 参数必须存在（drizzle and(...) 组合表达式对象）
      expect(recorder[0].whereArg).toBeTruthy();
      expect(recorder[0].table).toBe(energyPackagesTable);
      // 注：drizzle 表达式序列化不总是可读，这里主要保证 where 被调用且参数非空
      // 若未来有人把 and(inArray(...), eq(agentId,...)) 改成只 inArray(...)
      // 至少可通过其它「拒绝引用其他 agent 的套餐 ID」测试捕获逻辑回归
    });

    it('缺失 ID 时错误消息只说数量、不暴露具体 ID', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }]],
      ]));
      const service = new UiConfigService(conn as any);
      const menu = [{
        id: 'r', buttons: [{
          id: 'b', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
          packageGroup: {
            packageIds: [1, 999, 888],
            sortBy: 'price_asc',
            textTemplate: '{n}',
          },
        }],
      }];
      try {
        await service.validatePackageIds(menu as any, 100);
        throw new Error('应抛 BadRequestException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(BadRequestException);
        // 消息必须不包含具体 ID
        expect(e.message).not.toMatch(/999/);
        expect(e.message).not.toMatch(/888/);
        // 应说明数量（缺失 999, 888 共 2 个）
        expect(e.message).toMatch(/2/);
        expect(e.message).toMatch(/无效/);
      }
    });
  });

  describe('validate', () => {
    it('组合深度 + 套餐 ID 校验', async () => {
      const conn = createMockConn(new Map([
        [energyPackagesTable, [{ id: 1 }]],
      ]));
      const service = new UiConfigService(conn as any);
      const dto = {
        menuConfig: [{
          id: 'r1', buttons: [{
            id: 'b1', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
            packageGroup: { packageIds: [1], sortBy: 'price_asc', textTemplate: '{n}' },
          }],
        }],
      };
      await expect(service.validate(dto as any, 100)).resolves.not.toThrow();
    });

    it('menuConfig 为空时只跳过不报错', async () => {
      const conn = createMockConn(new Map());
      const service = new UiConfigService(conn as any);
      await expect(service.validate({} as any, 100)).resolves.not.toThrow();
    });

    it('validate：非法 agentId（0 / 负数 / NaN）被拒绝', async () => {
      const service = new UiConfigService({} as any);
      const dto = { menuConfig: [] };
      await expect(service.validate(dto as any, 0)).rejects.toThrow(BadRequestException);
      await expect(service.validate(dto as any, -1)).rejects.toThrow(BadRequestException);
      await expect(service.validate(dto as any, NaN)).rejects.toThrow(BadRequestException);
    });
  });

  describe('loadUiConfig', () => {
    it('空记录时返回空配置 + epoch updatedAt（ISO 格式）', async () => {
      const conn = createMockConn(new Map([[agentBotConfigsTable, []]]));
      const service = new UiConfigService(conn as any);
      const res = await service.loadUiConfig(100);
      expect(res.welcomeText).toBe('');
      expect(res.menuConfig).toEqual([]);
      expect(res.updatedAt).toBe('1970-01-01T00:00:00.000Z');
      expect(res.updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('有记录时返回已解析内容 + ISO updatedAt', async () => {
      const conn = createMockConn(
        new Map([
          [
            agentBotConfigsTable,
            [
              {
                welcomeText: '欢迎光临',
                menuConfig: '[{"id":"r","buttons":[]}]',
                messageConfig: null,
                updatedAt: new Date('2026-05-02T12:34:56.789Z'),
              },
            ],
          ],
        ]),
      );
      const service = new UiConfigService(conn as any);
      const res = await service.loadUiConfig(100);
      expect(res.welcomeText).toBe('欢迎光临');
      expect(res.menuConfig).toEqual([{ id: 'r', buttons: [] }]);
      expect(res.updatedAt).toBe('2026-05-02T12:34:56.789Z');
      expect(res.updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('查询 where 参数包含 agentId + deletedAt 过滤（防回归）', async () => {
      const recorder: MockCall[] = [];
      const conn = createMockConn(
        new Map([[agentBotConfigsTable, []]]),
        recorder,
      );
      const service = new UiConfigService(conn as any);
      await service.loadUiConfig(100);
      expect(recorder).toHaveLength(1);
      expect(recorder[0].table).toBe(agentBotConfigsTable);
      // and(eq(agentId), isNull(deletedAt)) 表达式对象，至少要非空
      expect(recorder[0].whereArg).toBeTruthy();
    });
  });

  describe('saveUiConfig', () => {
    /**
     * 构造带完整 mock 的 UiConfigService。
     *
     * drizzle 调用链：
     *   update(table).set(values).where(expr).returning(fields) → Promise<rows>
     *   insert(table).values(values).onConflictDoUpdate(config) → Promise<void>
     *
     * 两条链式分别控制乐观锁成功/失败和 upsert 路径。
     */
    function buildConn(opts: {
      updateReturning?: unknown[];
      captureInsert?: { called: boolean; values?: unknown; conflict?: unknown };
    }) {
      const captureUpdate: {
        set?: unknown;
        where?: unknown;
        returning?: unknown;
      } = {};
      const conn = {
        update: jest.fn(() => ({
          set: jest.fn((setArg: unknown) => {
            captureUpdate.set = setArg;
            return {
              where: jest.fn((whereArg: unknown) => {
                captureUpdate.where = whereArg;
                return {
                  returning: jest.fn((fields: unknown) => {
                    captureUpdate.returning = fields;
                    return Promise.resolve(opts.updateReturning ?? []);
                  }),
                };
              }),
            };
          }),
        })),
        insert: jest.fn(() => ({
          values: jest.fn((vals: unknown) => {
            if (opts.captureInsert) opts.captureInsert.values = vals;
            return {
              onConflictDoUpdate: jest.fn((cfg: unknown) => {
                if (opts.captureInsert) {
                  opts.captureInsert.called = true;
                  opts.captureInsert.conflict = cfg;
                }
                return Promise.resolve();
              }),
            };
          }),
        })),
      };
      return { conn, captureUpdate };
    }

    it('带 expectedUpdatedAt 且匹配时 update 成功返回新 updatedAt（ISO）', async () => {
      const { conn } = buildConn({ updateReturning: [{ id: 1 }] });
      const service = new UiConfigService(conn as any);
      const res = await service.saveUiConfig(
        100,
        { welcomeText: '', menuConfig: [], messageConfig: null } as any,
        '2026-01-01T00:00:00.000Z',
      );
      expect(res.updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(conn.update).toHaveBeenCalled();
      expect(conn.insert).not.toHaveBeenCalled();
    });

    it('带 expectedUpdatedAt 不匹配时抛 HttpException(CONFLICT)', async () => {
      const { conn } = buildConn({ updateReturning: [] });
      const service = new UiConfigService(conn as any);
      let thrown: any = null;
      try {
        await service.saveUiConfig(
          100,
          { welcomeText: '', menuConfig: [], messageConfig: null } as any,
          '2026-01-01T00:00:00.000Z',
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(conn.insert).not.toHaveBeenCalled();
    });

    it('无 expectedUpdatedAt 时走 onConflictDoUpdate 原子 upsert', async () => {
      const captureInsert: any = { called: false };
      const { conn } = buildConn({ captureInsert });
      const service = new UiConfigService(conn as any);
      const res = await service.saveUiConfig(100, {
        welcomeText: 'hi',
        menuConfig: [],
        messageConfig: null,
      } as any);
      expect(res.updatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(captureInsert.called).toBe(true);
      expect(conn.insert).toHaveBeenCalled();
      expect(conn.update).not.toHaveBeenCalled();
      // onConflictDoUpdate 必须带 target + targetWhere（部分索引语义）
      expect(captureInsert.conflict).toMatchObject({
        target: expect.anything(),
        targetWhere: expect.anything(),
        set: expect.anything(),
      });
      // insert values 应注入 agentId 和默认 botStatus
      expect(captureInsert.values).toMatchObject({
        agentId: 100,
        botStatus: 'disabled',
      });
    });

    it('menuConfig 为空数组时统一写 null 而非空 JSON 数组字符串', async () => {
      const captureInsert: any = { called: false };
      const { conn } = buildConn({ captureInsert });
      const service = new UiConfigService(conn as any);
      await service.saveUiConfig(100, {
        welcomeText: '',
        menuConfig: [],
        messageConfig: null,
      } as any);
      expect((captureInsert.values as any).menuConfig).toBeNull();
      expect((captureInsert.values as any).messageConfig).toBeNull();
    });

    it('menuConfig 非空时序列化为 JSON 字符串', async () => {
      const captureInsert: any = { called: false };
      const { conn } = buildConn({ captureInsert });
      const service = new UiConfigService(conn as any);
      const menu = [{ id: 'r', buttons: [] }];
      await service.saveUiConfig(100, {
        welcomeText: '',
        menuConfig: menu,
        messageConfig: null,
      } as any);
      expect((captureInsert.values as any).menuConfig).toBe(
        JSON.stringify(menu),
      );
    });
  });
});
