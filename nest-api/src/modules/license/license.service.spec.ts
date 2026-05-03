import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LicenseService } from './license.service';
import { NonceCacheService } from '../../common/nonce/nonce-cache.service';
import { PrecheckErrorCode } from './dto/license.dto';
import {
  aesGcmEncryptToBase64,
  loadKeyFromBase64,
} from '../../common/crypto/aes-gcm.util';
import { signCanonicalRequest } from '../../common/crypto/hmac.util';

/**
 * LicenseService 单元测试。
 *
 * 策略：直接实例化 service，手工构造 drizzle conn / configService / nonce cache 的 mock。
 * 真实验证加密、签名、precheck 错误路径和业务状态流转。
 */
describe('LicenseService', () => {
  const ENC_KEY_B64 = randomBytes(32).toString('base64');
  const ENC_KEY = loadKeyFromBase64(ENC_KEY_B64);

  /** 构造一个支持 insert/select/update/transaction 的 drizzle conn mock。 */
  function createMockConn() {
    const state = {
      inserts: [] as Array<{ table: unknown; values: any }>,
      updates: [] as Array<{ table: unknown; set: any; where: any }>,
      selectRows: [] as any[],
      // 允许每个 select 链根据调用次数顺序返回不同结果
      selectResponses: [] as any[][],
      selectIndex: 0,
    };

    const chain = (finalRows: any) => ({
      from: jest.fn(() => ({
        innerJoin: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve(finalRows)),
            })),
            limit: jest.fn(() => Promise.resolve(finalRows)),
          })),
        })),
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => Promise.resolve(finalRows)),
          })),
          limit: jest.fn(() => Promise.resolve(finalRows)),
          then: (resolve: any) => resolve(finalRows),
        })),
      })),
    });

    const conn: any = {
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((values: any) => {
          state.inserts.push({ table, values });
          return Promise.resolve();
        }),
      })),
      update: jest.fn((table: unknown) => ({
        set: jest.fn((set: any) => ({
          where: jest.fn((where: any) => {
            state.updates.push({ table, set, where });
            return Promise.resolve();
          }),
        })),
      })),
      select: jest.fn(() => {
        const rows = state.selectResponses[state.selectIndex++] ?? state.selectRows;
        return chain(rows);
      }),
      transaction: jest.fn(async (cb: any) => cb(conn)),
      _state: state,
    };
    return conn;
  }

  function createService(opts?: {
    conn?: any;
    configGet?: (k: string) => string | undefined;
    nonce?: Partial<NonceCacheService>;
  }) {
    const conn = opts?.conn ?? createMockConn();
    const config: any = {
      get: jest.fn((k: string) => {
        if (opts?.configGet) return opts.configGet(k);
        if (k === 'LICENSE_SECRET_ENC_KEY') return ENC_KEY_B64;
        return undefined;
      }),
    };
    const nonce = Object.assign(new NonceCacheService(), opts?.nonce ?? {});
    const svc = new LicenseService(conn, config, nonce as any);
    return { svc, conn, config, nonce };
  }

  describe('constructor', () => {
    it('缺少 LICENSE_SECRET_ENC_KEY 抛错', () => {
      expect(() =>
        createService({ configGet: () => undefined }),
      ).toThrow(/LICENSE_SECRET_ENC_KEY/);
    });

    it('非法 base64 长度抛错', () => {
      expect(() =>
        createService({ configGet: () => randomBytes(16).toString('base64') }),
      ).toThrow(/32 字节/);
    });
  });

  describe('generate', () => {
    it('生成合法 key/secret 并写 DB', async () => {
      const { svc, conn } = createService();
      const res = await svc.generate(1, 42);
      expect(res.licenseKey).toMatch(/^ebt_/);
      expect(res.licenseSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.installCommand).toContain(res.licenseKey);
      expect(res.installCommand).toContain(res.licenseSecret);
      expect(conn._state.inserts).toHaveLength(1);
      expect(conn._state.inserts[0].values.customerId).toBe(1);
      expect(conn._state.inserts[0].values.issuedBy).toBe(42);
      // 密文非 secret 明文
      expect(conn._state.inserts[0].values.secretCipher).not.toBe(res.licenseSecret);
    });

    it('install 命令使用默认 base URL', async () => {
      const { svc } = createService();
      const res = await svc.generate(1, 1);
      expect(res.installCommand).toContain(LicenseService.DEFAULT_BASE_URL);
    });

    it('install 命令可被 INSTALL_BASE_URL 覆盖', async () => {
      const { svc } = createService({
        configGet: (k) => {
          if (k === 'LICENSE_SECRET_ENC_KEY') return ENC_KEY_B64;
          if (k === 'INSTALL_BASE_URL') return 'https://custom.example.com';
          return undefined;
        },
      });
      const res = await svc.generate(1, 1);
      expect(res.installCommand).toContain('https://custom.example.com');
    });
  });

  describe('revoke', () => {
    it('license 不存在抛 NotFound', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      await expect(svc.revoke(999)).rejects.toThrow(NotFoundException);
    });

    it('已吊销时幂等（不再写更新）', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ revokedAt: new Date() }]);
      await svc.revoke(1);
      expect(conn._state.updates).toHaveLength(0);
    });

    it('有效时写入 revoked_at 和原因', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ revokedAt: null }]);
      await svc.revoke(1, '客户要求');
      expect(conn._state.updates).toHaveLength(1);
      expect(conn._state.updates[0].set.revokedAt).toBeInstanceOf(Date);
      expect(conn._state.updates[0].set.revokedReason).toBe('客户要求');
    });
  });

  describe('verifyPrecheck', () => {
    function buildValidRequest(overrides: Partial<{
      licenseKey: string;
      timestamp: string;
      nonce: string;
      secret: string;
    }> = {}) {
      const licenseKey = overrides.licenseKey ?? 'ebt_' + 'A'.repeat(32);
      const timestamp = overrides.timestamp ?? String(Date.now());
      const nonce = overrides.nonce ?? randomBytes(16).toString('hex');
      const secret = overrides.secret ?? 'secret-xyz';
      const signature = signCanonicalRequest({
        secret,
        method: 'POST',
        path: '/api/v1/license/precheck',
        timestamp,
        nonce,
        body: '',
      });
      return { licenseKey, timestamp, nonce, signature, secret };
    }

    function withRowResponse(conn: any, row: any) {
      conn._state.selectResponses.push([row]);
    }

    const validArgs = (req: ReturnType<typeof buildValidRequest>) => ({
      licenseKey: req.licenseKey,
      timestamp: req.timestamp,
      nonce: req.nonce,
      signature: req.signature,
      method: 'POST',
      path: '/api/v1/license/precheck',
      body: '',
    });

    it('license 不存在返回 KEY_NOT_FOUND', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      const req = buildValidRequest();
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toMatchObject({
        message: PrecheckErrorCode.KEY_NOT_FOUND,
      });
    });

    it('license 已吊销返回 LICENSE_REVOKED', async () => {
      const { svc, conn } = createService();
      const req = buildValidRequest();
      withRowResponse(conn, {
        licenseId: 1,
        customerId: 1,
        customerName: 'A',
        customerStatus: 'active',
        licenseRevokedAt: new Date(),
        secretCipher: aesGcmEncryptToBase64(req.secret, ENC_KEY),
      });
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('customer 已 suspended 返回 CUSTOMER_SUSPENDED', async () => {
      const { svc, conn } = createService();
      const req = buildValidRequest();
      withRowResponse(conn, {
        licenseId: 1,
        customerId: 1,
        customerName: 'A',
        customerStatus: 'suspended',
        licenseRevokedAt: null,
        secretCipher: aesGcmEncryptToBase64(req.secret, ENC_KEY),
      });
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toMatchObject({
        message: PrecheckErrorCode.CUSTOMER_SUSPENDED,
      });
    });

    it('时钟偏移超窗口返回 CLOCK_SKEW', async () => {
      const { svc } = createService();
      const req = buildValidRequest({
        timestamp: String(Date.now() - 10 * 60 * 1000),
      });
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toMatchObject({
        message: PrecheckErrorCode.CLOCK_SKEW,
      });
    });

    it('签名错误返回 SIGNATURE_INVALID', async () => {
      const { svc, conn } = createService();
      const req = buildValidRequest();
      withRowResponse(conn, {
        licenseId: 1,
        customerId: 1,
        customerName: 'A',
        customerStatus: 'active',
        licenseRevokedAt: null,
        secretCipher: aesGcmEncryptToBase64('WRONG-SECRET', ENC_KEY),
      });
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toMatchObject({
        message: PrecheckErrorCode.SIGNATURE_INVALID,
      });
    });

    it('nonce 重放返回 NONCE_REPLAYED', async () => {
      const { svc, conn } = createService();
      const req = buildValidRequest();
      const row = {
        licenseId: 1,
        customerId: 1,
        customerName: 'A',
        customerStatus: 'active',
        licenseRevokedAt: null,
        secretCipher: aesGcmEncryptToBase64(req.secret, ENC_KEY),
      };
      conn._state.selectResponses.push([row]);
      conn._state.selectResponses.push([row]);

      const res1 = await svc.verifyPrecheck(validArgs(req));
      expect(res1.customerName).toBe('A');

      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toMatchObject({
        message: PrecheckErrorCode.NONCE_REPLAYED,
      });
    });

    it('完全合法返回 customer 名称', async () => {
      const { svc, conn } = createService();
      const req = buildValidRequest();
      withRowResponse(conn, {
        licenseId: 1,
        customerId: 1,
        customerName: '测试客户 A',
        customerStatus: 'active',
        licenseRevokedAt: null,
        secretCipher: aesGcmEncryptToBase64(req.secret, ENC_KEY),
      });
      const res = await svc.verifyPrecheck(validArgs(req));
      expect(res.customerName).toBe('测试客户 A');
      expect(typeof res.serverTime).toBe('number');
    });

    it('非法 licenseKey 格式返回 BadRequest', async () => {
      const { svc } = createService();
      const req = buildValidRequest({ licenseKey: 'not-valid' });
      await expect(svc.verifyPrecheck(validArgs(req))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('非法 timestamp 返回 BadRequest', async () => {
      const { svc } = createService();
      const req = buildValidRequest();
      await expect(
        svc.verifyPrecheck({ ...validArgs(req), timestamp: 'abc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('非法 nonce 返回 BadRequest', async () => {
      const { svc } = createService();
      const req = buildValidRequest();
      await expect(
        svc.verifyPrecheck({ ...validArgs(req), nonce: 'zzz' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('非法 signature 格式返回 BadRequest', async () => {
      const { svc } = createService();
      const req = buildValidRequest();
      await expect(
        svc.verifyPrecheck({ ...validArgs(req), signature: 'abc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reissue', () => {
    it('吊销旧 license 并生成新 license', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([{ id: 10 }, { id: 11 }]); // 两条有效（异常情况也处理）
      const res = await svc.reissue(1, 7);
      expect(res.licenseKey).toMatch(/^ebt_/);
      // 两条旧的都应 revoke
      expect(conn._state.updates).toHaveLength(2);
      expect(conn._state.updates[0].set.revokedAt).toBeInstanceOf(Date);
      expect(conn._state.updates[0].set.revokedReason).toBe('重新颁发');
      // 新的插入一条
      expect(conn._state.inserts).toHaveLength(1);
    });

    it('无有效 license 时仍生成新的', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      const res = await svc.reissue(1, 7);
      expect(res.licenseKey).toMatch(/^ebt_/);
      expect(conn._state.updates).toHaveLength(0);
      expect(conn._state.inserts).toHaveLength(1);
    });
  });

  describe('getInstallCommand', () => {
    it('有现役 license 时返回命令', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([
        {
          licenseKey: 'ebt_' + 'B'.repeat(32),
          secretCipher: aesGcmEncryptToBase64('original-secret', ENC_KEY),
        },
      ]);
      const cmd = await svc.getInstallCommand(1);
      expect(cmd).toContain('original-secret');
      expect(cmd).toContain('ebt_');
    });

    it('无现役 license 时返回 null', async () => {
      const { svc, conn } = createService();
      conn._state.selectResponses.push([]);
      const cmd = await svc.getInstallCommand(1);
      expect(cmd).toBeNull();
    });
  });
});
