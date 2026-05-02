import { BadRequestException } from '@nestjs/common';
import { UiConfigService } from './ui-config.service';
import { ButtonAction } from '../dto/ui-config.dto';
import { energyPackagesTable } from '../../../drizzle/schema';

// drizzle conn mock：支持 select().from().where() 链式调用，按 table 返回预设行
function createMockConn(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => ({
        where: jest.fn(() => Promise.resolve(rowsByTable.get(table) ?? [])),
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

    it('存在不在数据库的套餐 ID 时抛 BadRequestException', async () => {
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
      await expect(service.validatePackageIds(menu as any, 100))
        .rejects.toThrow(/999/);
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
  });
});
