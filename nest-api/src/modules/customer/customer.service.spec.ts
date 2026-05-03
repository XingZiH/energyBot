import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerService } from './customer.service';

describe('CustomerService', () => {
  function createMockConn() {
    const state = {
      inserts: [] as any[],
      updates: [] as any[],
      selectResponses: [] as any[][],
      selectIndex: 0,
      countResponses: [] as number[],
      countIndex: 0,
      insertReturnIds: [] as number[],
    };
    const buildSelectChain = (rows: any) => ({
      from: jest.fn(() => ({
        where: jest.fn(() => {
          const withOrder: any = {
            orderBy: jest.fn(() => {
              const withLimit: any = {
                limit: jest.fn(() => ({
                  offset: jest.fn(() => Promise.resolve(rows)),
                })),
                then: (resolve: any) => resolve(rows),
              };
              return withLimit;
            }),
            // 直接 .limit(n) 也要支持（create 里 userName 查重用）
            limit: jest.fn(() => Promise.resolve(rows)),
            then: (resolve: any) => resolve(rows),
          };
          return withOrder;
        }),
      })),
    });
    const conn: any = {
      insert: jest.fn(() => ({
        values: jest.fn((values: any) => {
          state.inserts.push(values);
          const nextId = state.insertReturnIds.shift() ?? 100;
          // 返回对象同时支持 .returning() 链式与 await（无 returning 的场景）
          const result: any = {
            returning: jest.fn(() => Promise.resolve([{ id: nextId }])),
            then: (resolve: any) => resolve(undefined),
          };
          return result;
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn((set: any) => ({
          where: jest.fn((where: any) => {
            state.updates.push({ set, where });
            return Promise.resolve();
          }),
        })),
      })),
      select: jest.fn(() => {
        const rows = state.selectResponses[state.selectIndex++] ?? [];
        return buildSelectChain(rows);
      }),
      $count: jest.fn(() => {
        return Promise.resolve(state.countResponses[state.countIndex++] ?? 0);
      }),
      transaction: jest.fn(async (cb: any) => cb(conn)),
      _state: state,
    };
    return conn;
  }

  function createService(opts?: { license?: any; conn?: any }) {
    const conn = opts?.conn ?? createMockConn();
    const license = opts?.license ?? {
      generate: jest.fn().mockResolvedValue({
        licenseKey: 'ebt_TEST',
        licenseSecret: 'secret',
        installCommand: 'cmd',
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
      reissue: jest.fn().mockResolvedValue({
        licenseKey: 'ebt_NEW',
        licenseSecret: 'new-secret',
        installCommand: 'new-cmd',
      }),
      getInstallCommand: jest.fn().mockResolvedValue('cached-cmd'),
    };
    const svc = new CustomerService(conn, license as any);
    return { svc, conn, license };
  }

  describe('create', () => {
    it('事务插入客户后为其生成 license', async () => {
      const { svc, conn, license } = createService();
      const result = await svc.create(
        { name: '客户甲', contact: 'tg:@a', remark: null as any },
        7,
      );
      expect(conn._state.inserts).toHaveLength(1);
      expect(conn._state.inserts[0].name).toBe('客户甲');
      expect(conn._state.inserts[0].createdBy).toBe(7);
      expect(license.generate).toHaveBeenCalledWith(100, 7);
      expect(result.customerId).toBe(100);
      expect(result.licenseKey).toBe('ebt_TEST');
      expect(result.loginUserCreated).toBe(false);
    });

    it('提供 loginUserName 但缺 loginPassword 时抛 BadRequest', async () => {
      const { svc, license } = createService();
      await expect(
        svc.create(
          { name: '客户甲', loginUserName: 'alice' } as any,
          7,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(license.generate).not.toHaveBeenCalled();
    });

    it('提供 loginPassword 但缺 loginUserName 时抛 BadRequest', async () => {
      const { svc, license } = createService();
      await expect(
        svc.create(
          { name: '客户甲', loginPassword: 'secret123' } as any,
          7,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(license.generate).not.toHaveBeenCalled();
    });

    it('同时提供 loginUserName/Password 时事务里创建 user + sys_user_role 并绑定 customer_id', async () => {
      const { svc, conn, license } = createService();
      // 查重 select：用户名未被占用
      conn._state.selectResponses.push([]);
      // customers insert → id=200；user insert → id=555；sys_user_role insert
      conn._state.insertReturnIds.push(200, 555);

      const result = await svc.create(
        {
          name: '客户乙',
          loginUserName: 'alice',
          loginPassword: 'secret123',
        } as any,
        7,
      );

      // 插入顺序：customers(1) → user(2) → sys_user_role(3)
      expect(conn._state.inserts).toHaveLength(3);
      const [customerIns, userIns, roleIns] = conn._state.inserts;
      expect(customerIns.name).toBe('客户乙');
      expect(userIns.userName).toBe('alice');
      expect(userIns.customerId).toBe(200);
      expect(userIns.available).toBe(true);
      expect(userIns.password).toMatch(/^\$argon2/); // argon2 hash 前缀
      expect(roleIns.userId).toBe(555);
      expect(roleIns.roleId).toBe(3); // DEFAULT_CUSTOMER_LOGIN_ROLE_ID
      expect(license.generate).toHaveBeenCalledWith(200, 7);
      expect(result.loginUserCreated).toBe(true);
      expect(result.loginUserName).toBe('alice');
    });

    it('loginUserName 已被占用时抛 Conflict 且不 insert', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([{ id: 999 }]); // 命中已存在用户
      await expect(
        svc.create(
          {
            name: '客户丙',
            loginUserName: 'taken',
            loginPassword: 'secret123',
          } as any,
          7,
        ),
      ).rejects.toThrow(ConflictException);
      expect(conn._state.inserts).toHaveLength(0);
      expect(license.generate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('返回 customer + hasActiveLicense 徽章', async () => {
      const { svc, conn } = createService();
      // 第 1 次 select：customers 列表
      conn._state.selectResponses.push([
        { id: 1, name: '甲', status: 'active', contact: null, remark: null, createdBy: 1, createdAt: new Date() },
        { id: 2, name: '乙', status: 'suspended', contact: null, remark: null, createdBy: 1, createdAt: new Date() },
      ]);
      // 第 2 次 select：licenses active 列表
      conn._state.selectResponses.push([
        { customerId: 1, licenseKey: 'ebt_A', lastSeenAt: null },
      ]);
      conn._state.countResponses.push(2);

      const res = await svc.list({ pageIndex: 1, pageSize: 20 } as any);
      expect(res.total).toBe(2);
      expect(res.list).toHaveLength(2);
      expect(res.list[0].hasActiveLicense).toBe(true);
      expect(res.list[0].activeLicenseKey).toBe('ebt_A');
      expect(res.list[1].hasActiveLicense).toBe(false);
    });

    it('参数无效时使用默认分页', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      conn._state.selectResponses.push([]);
      conn._state.countResponses.push(0);
      const res = await svc.list({ pageIndex: 0, pageSize: 0 } as any);
      expect(res.pageSize).toBe(10);
      expect(res.pageIndex).toBe(1);
    });
  });

  describe('findById', () => {
    it('不存在时抛 NotFound', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      await expect(svc.findById(1)).rejects.toThrow(NotFoundException);
    });

    it('存在时返回客户 + licenses 历史', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([
        { id: 1, name: '甲', status: 'active', deletedAt: null },
      ]);
      conn._state.selectResponses.push([
        { id: 10, licenseKey: 'ebt_X', issuedAt: new Date(), revokedAt: null },
      ]);
      const res = await svc.findById(1);
      expect(res.licenses).toHaveLength(1);
      expect(res.licenses[0].licenseKey).toBe('ebt_X');
    });
  });

  describe('update', () => {
    it('客户不存在抛 NotFound', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      await expect(
        svc.update({ id: 99, name: '新名' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('存在时落库 set 字段（不含 id）', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ id: 1 }]);
      await svc.update({ id: 1, name: '新名', status: 'suspended' } as any);
      expect(conn._state.updates).toHaveLength(1);
      expect(conn._state.updates[0].set.name).toBe('新名');
      expect(conn._state.updates[0].set.status).toBe('suspended');
      expect(conn._state.updates[0].set.id).toBeUndefined();
    });
  });

  describe('revokeLicense', () => {
    it('按条调用 LicenseService.revoke', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([{ id: 10 }, { id: 11 }]);
      const res = await svc.revokeLicense(1, '测试');
      expect(license.revoke).toHaveBeenCalledTimes(2);
      expect(license.revoke).toHaveBeenCalledWith(10, '测试');
      expect(license.revoke).toHaveBeenCalledWith(11, '测试');
      expect(res.revokedCount).toBe(2);
    });

    it('无有效 license 时幂等返回 0', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([]);
      const res = await svc.revokeLicense(1);
      expect(license.revoke).not.toHaveBeenCalled();
      expect(res.revokedCount).toBe(0);
    });
  });

  describe('reissueLicense', () => {
    it('客户不存在抛 NotFound', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([]);
      await expect(svc.reissueLicense(9, 1, 'x')).rejects.toThrow(NotFoundException);
      expect(license.reissue).not.toHaveBeenCalled();
    });

    it('存在时委托 LicenseService.reissue', async () => {
      const { svc, conn, license } = createService();
      conn._state.selectResponses.push([{ id: 1 }]);
      const res = await svc.reissueLicense(1, 7, '手动');
      expect(license.reissue).toHaveBeenCalledWith(1, 7, '手动');
      expect(res.licenseKey).toBe('ebt_NEW');
    });
  });

  describe('getInstallCommand', () => {
    it('有 license 时返回命令', async () => {
      const { svc } = createService();
      const cmd = await svc.getInstallCommand(1);
      expect(cmd).toBe('cached-cmd');
    });

    it('无 license 时抛 NotFound', async () => {
      const { svc, license } = createService({
        license: { getInstallCommand: jest.fn().mockResolvedValue(null) },
      });
      await expect(svc.getInstallCommand(1)).rejects.toThrow(NotFoundException);
    });
  });
});
