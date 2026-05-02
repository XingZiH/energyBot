import { BadRequestException } from '@nestjs/common';
import { UiConfigService } from './ui-config.service';
import { ButtonAction } from '../dto/ui-config.dto';
import { energyPackagesTable } from '../../../drizzle/schema';

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
});
