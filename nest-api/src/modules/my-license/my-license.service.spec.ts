import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MyLicenseService } from './my-license.service';

/**
 * MyLicenseService 单元测试。
 *
 * 关键断言：
 * - 入参是 JWT 取到的 userId；禁止任何 customerId 入参
 * - user.customer_id 为 NULL 时抛 NotFound（避免让管理员误入看到一堆空）
 * - 用户不存在抛 Unauthorized
 * - 有 license 时 view 里字段正确；无 license 时 licenseStatus='none'
 * - getInstallCommand 委托给 LicenseService；无现役 license 时抛 NotFound
 */
describe('MyLicenseService', () => {
  function createMockConn() {
    const state = {
      selectResponses: [] as any[][],
      selectIndex: 0,
    };
    const buildSelectChain = (rows: any) => ({
      from: jest.fn(() => ({
        where: jest.fn(() => {
          const withOrder: any = {
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve(rows)),
            })),
            limit: jest.fn(() => Promise.resolve(rows)),
            then: (resolve: any) => resolve(rows),
          };
          return withOrder;
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

  function createService(licenseOverride?: any) {
    const conn = createMockConn();
    const license = licenseOverride ?? {
      getInstallCommand: jest.fn().mockResolvedValue('curl xxx install.sh'),
    };
    const svc = new MyLicenseService(conn, license);
    return { svc, conn, license };
  }

  describe('findByUserId', () => {
    it('用户不存在抛 Unauthorized', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      await expect(svc.findByUserId(99)).rejects.toThrow(UnauthorizedException);
    });

    it('用户未绑定 customer（admin 误入）抛 NotFound', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ userId: 1, customerId: null }]);
      await expect(svc.findByUserId(1)).rejects.toThrow(NotFoundException);
    });

    it('绑定的 customer 已软删时抛 NotFound（不泄漏数据）', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ userId: 1, customerId: 55 }]);
      conn._state.selectResponses.push([]); // customer 查不到
      await expect(svc.findByUserId(1)).rejects.toThrow(NotFoundException);
    });

    it('正常返回：无任何 license 时 licenseStatus=none', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ userId: 1, customerId: 55 }]);
      conn._state.selectResponses.push([
        { id: 55, name: '客户甲', status: 'active' },
      ]);
      conn._state.selectResponses.push([]); // 无 license 记录
      const view = await svc.findByUserId(1);
      expect(view.customerId).toBe(55);
      expect(view.customerName).toBe('客户甲');
      expect(view.licenseKey).toBeNull();
      expect(view.licenseStatus).toBe('none');
    });

    it('有现役 license 时 licenseStatus=active 并携带 lastSeenAt', async () => {
      const { svc, conn } = createService();
      const issuedAt = new Date('2026-05-03T10:00:00Z');
      const lastSeen = new Date('2026-05-03T11:00:00Z');
      conn._state.selectResponses.push([{ userId: 1, customerId: 55 }]);
      conn._state.selectResponses.push([
        { id: 55, name: '客户甲', status: 'active' },
      ]);
      conn._state.selectResponses.push([
        {
          licenseKey: 'ebt_ABC',
          issuedAt,
          revokedAt: null,
          revokedReason: null,
          lastSeenAt: lastSeen,
        },
      ]);
      const view = await svc.findByUserId(1);
      expect(view.licenseKey).toBe('ebt_ABC');
      expect(view.licenseStatus).toBe('active');
      expect(view.lastSeenAt).toBe(lastSeen.toISOString());
      expect(view.revokedAt).toBeNull();
    });

    it('已吊销 license 时 licenseStatus=revoked 并携带原因', async () => {
      const { svc, conn } = createService();
      const revokedAt = new Date('2026-05-03T12:00:00Z');
      conn._state.selectResponses.push([{ userId: 1, customerId: 55 }]);
      conn._state.selectResponses.push([
        { id: 55, name: '客户甲', status: 'suspended' },
      ]);
      conn._state.selectResponses.push([
        {
          licenseKey: 'ebt_OLD',
          issuedAt: new Date(),
          revokedAt,
          revokedReason: '合同到期',
          lastSeenAt: null,
        },
      ]);
      const view = await svc.findByUserId(1);
      expect(view.licenseStatus).toBe('revoked');
      expect(view.revokedReason).toBe('合同到期');
      expect(view.customerStatus).toBe('suspended');
    });
  });

  describe('getInstallCommand', () => {
    it('用户不存在抛 Unauthorized', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      await expect(svc.getInstallCommand(99)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('未绑定客户抛 NotFound', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ customerId: null }]);
      await expect(svc.getInstallCommand(1)).rejects.toThrow(NotFoundException);
    });

    it('无现役 license 时抛 NotFound', async () => {
      const { svc, conn, license } = createService({
        getInstallCommand: jest.fn().mockResolvedValue(null),
      });
      conn._state.selectResponses.push([{ customerId: 55 }]);
      await expect(svc.getInstallCommand(1)).rejects.toThrow(NotFoundException);
      expect(license.getInstallCommand).toHaveBeenCalledWith(55);
    });

    it('有现役 license 时返回安装命令', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([{ customerId: 55 }]);
      const cmd = await svc.getInstallCommand(1);
      expect(cmd).toBe('curl xxx install.sh');
      expect(license.getInstallCommand).toHaveBeenCalledWith(55);
    });
  });
});
