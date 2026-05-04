import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import { customersTable, licensesTable } from '../../drizzle/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ConfigEnum } from '../../enum/config.enum';
import {
  aesGcmDecryptFromBase64,
  aesGcmEncryptToBase64,
  loadKeyFromBase64,
} from '../../common/crypto/aes-gcm.util';
import {
  generateLicenseKey,
  generateLicenseSecret,
  isValidLicenseKeyFormat,
} from '../../common/crypto/license-key.util';
import { verifyCanonicalRequest } from '../../common/crypto/hmac.util';
import { NonceCacheService } from '../../common/nonce/nonce-cache.service';
import { PrecheckErrorCode } from './dto/license.dto';

/**
 * License 颁发与校验服务。
 *
 * 职责：
 * - generate          为客户创建一条 license 记录（明文 secret 仅此一次返回）
 * - revoke            将 license 标记为吊销
 * - reissue           原子吊销旧的并生成新的
 * - findActiveByKey   按 key 查询有效 license（含 customer 关联）
 * - verifyPrecheck    客户端 install.sh 的核心端点：综合校验 key 状态、时钟偏移、
 *                     HMAC 签名和 nonce 重放
 *
 * 密钥加密：所有 licenses.secret_cipher 用 AES-256-GCM 加密存储，密钥来自
 * env LICENSE_SECRET_ENC_KEY（32B base64）。加载一次后驻留内存。
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  /** 时钟偏移容忍度（毫秒）。客户端 timestamp 超出该窗口视为攻击或时钟未同步。 */
  public static readonly CLOCK_SKEW_MS = 5 * 60 * 1000;

  /** Nonce 缓存 TTL：与时钟偏移窗口对齐。 */
  public static readonly NONCE_TTL_MS = 5 * 60 * 1000;

  /** 默认 install 命令模板中的基础 URL（公开部署域名）。 */
  public static readonly DEFAULT_BASE_URL = 'https://www.feiyijt.com';

  private readonly encKey: Buffer;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly conn: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
    private readonly nonceCache: NonceCacheService,
  ) {
    const raw = this.configService.get<string>(ConfigEnum.LICENSE_SECRET_ENC_KEY);
    if (!raw) {
      throw new Error(
        `启动失败：env ${ConfigEnum.LICENSE_SECRET_ENC_KEY} 未配置（生成命令：openssl rand -base64 32）`,
      );
    }
    this.encKey = loadKeyFromBase64(raw);
  }

  /**
   * 为指定客户生成新 license。返回明文 key + secret，调用方
   * 只能在此次调用中看到 secret 明文——写入 DB 的是加密密文。
   *
   * @param customerId  目标客户 id
   * @param issuedBy    颁发人 userId（审计字段）
   * @param tx          可选 Drizzle 事务句柄。当调用方需要把 license 与 user/customer
   *                    创建放在同一事务（signup 自助注册、存量补齐脚本）时传入，
   *                    事务失败会连带回滚这条 license。不传时使用默认连接（兼容
   *                    原有"事务外补发"语义，如 CustomerService.create 的 admin 运营路径）。
   */
  async generate(
    customerId: number,
    issuedBy: number,
    tx?: NodePgDatabase<typeof schema>,
  ) {
    const licenseKey = generateLicenseKey();
    const licenseSecret = generateLicenseSecret();
    const secretCipher = aesGcmEncryptToBase64(licenseSecret, this.encKey);

    const executor = tx ?? this.conn;
    await executor.insert(licensesTable).values({
      customerId,
      licenseKey,
      secretCipher,
      issuedBy,
    });

    return {
      licenseKey,
      licenseSecret,
      installCommand: this.buildInstallCommand(licenseKey, licenseSecret),
    };
  }

  /** 拼装 install.sh 一键安装命令（明文展示给客户）。 */
  buildInstallCommand(licenseKey: string, licenseSecret: string): string {
    const base = this.configService.get<string>('INSTALL_BASE_URL') ?? LicenseService.DEFAULT_BASE_URL;
    return (
      `curl -fsSL ${base}/install.sh | ` +
      `LICENSE_KEY='${licenseKey}' LICENSE_SECRET='${licenseSecret}' sh`
    );
  }

  /**
   * 将 license 标记为吊销。幂等：若已吊销则直接返回，不重复写。
   */
  async revoke(licenseId: number, reason?: string): Promise<void> {
    const rows = await this.conn
      .select({ revokedAt: licensesTable.revokedAt })
      .from(licensesTable)
      .where(eq(licensesTable.id, licenseId));
    if (rows.length === 0) {
      throw new NotFoundException('license 不存在');
    }
    if (rows[0].revokedAt) return;

    await this.conn
      .update(licensesTable)
      .set({
        revokedAt: new Date(),
        revokedReason: reason?.slice(0, 255),
      })
      .where(eq(licensesTable.id, licenseId));
  }

  /**
   * 为客户重新颁发 license：在事务里吊销当前有效 license（若有），再生成新的。
   */
  async reissue(customerId: number, issuedBy: number, reason = '重新颁发') {
    return this.conn.transaction(async (db) => {
      const active = await db
        .select({ id: licensesTable.id })
        .from(licensesTable)
        .where(
          and(
            eq(licensesTable.customerId, customerId),
            isNull(licensesTable.revokedAt),
          ),
        );
      for (const row of active) {
        await db
          .update(licensesTable)
          .set({
            revokedAt: new Date(),
            revokedReason: reason,
          })
          .where(eq(licensesTable.id, row.id));
      }

      const licenseKey = generateLicenseKey();
      const licenseSecret = generateLicenseSecret();
      const secretCipher = aesGcmEncryptToBase64(licenseSecret, this.encKey);

      await db.insert(licensesTable).values({
        customerId,
        licenseKey,
        secretCipher,
        issuedBy,
      });

      return {
        licenseKey,
        licenseSecret,
        installCommand: this.buildInstallCommand(licenseKey, licenseSecret),
      };
    });
  }

  /**
   * 按 licenseKey 查找有效（未吊销、customer 未 suspended）license。
   * 供管理端查询与 precheck 校验共用。
   */
  async findActiveByKey(licenseKey: string) {
    const rows = await this.conn
      .select({
        licenseId: licensesTable.id,
        customerId: licensesTable.customerId,
        customerName: customersTable.name,
        customerStatus: customersTable.status,
        licenseRevokedAt: licensesTable.revokedAt,
        secretCipher: licensesTable.secretCipher,
      })
      .from(licensesTable)
      .innerJoin(customersTable, eq(licensesTable.customerId, customersTable.id))
      .where(eq(licensesTable.licenseKey, licenseKey))
      .orderBy(desc(licensesTable.id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 客户端 precheck 总入口。任一失败抛 HTTP 异常（UnauthorizedException / ForbiddenException /
   * BadRequestException），异常消息里带标准错误码（PrecheckErrorCode）供 install.sh 做差异化提示。
   *
   * 成功则返回 { customerName, serverTime } 并更新 last_seen_at。
   */
  async verifyPrecheck(params: {
    licenseKey: string;
    timestamp: string;
    nonce: string;
    signature: string;
    method: string;
    path: string;
    body: string;
  }) {
    const { licenseKey, timestamp, nonce, signature, method, path, body } = params;

    // 基本格式
    if (!licenseKey || !isValidLicenseKeyFormat(licenseKey)) {
      throw new BadRequestException(PrecheckErrorCode.BAD_REQUEST);
    }
    if (!/^\d{10,16}$/.test(timestamp)) {
      throw new BadRequestException(PrecheckErrorCode.BAD_REQUEST);
    }
    if (!/^[0-9a-f]{32}$/i.test(nonce)) {
      throw new BadRequestException(PrecheckErrorCode.BAD_REQUEST);
    }
    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      throw new BadRequestException(PrecheckErrorCode.BAD_REQUEST);
    }

    // 时钟偏移
    const ts = Number(timestamp);
    const now = Date.now();
    if (Math.abs(now - ts) > LicenseService.CLOCK_SKEW_MS) {
      throw new UnauthorizedException(PrecheckErrorCode.CLOCK_SKEW);
    }

    // 查 license
    const row = await this.findActiveByKey(licenseKey);
    if (!row) {
      throw new UnauthorizedException(PrecheckErrorCode.KEY_NOT_FOUND);
    }
    if (row.licenseRevokedAt) {
      throw new ForbiddenException(PrecheckErrorCode.LICENSE_REVOKED);
    }
    if (row.customerStatus !== 'active') {
      throw new ForbiddenException(PrecheckErrorCode.CUSTOMER_SUSPENDED);
    }

    // 解密 secret，验签
    let secret: string;
    try {
      secret = aesGcmDecryptFromBase64(row.secretCipher, this.encKey);
    } catch (err) {
      // 密文损坏或密钥不对——属于服务端配置问题
      this.logger.error(`license ${row.licenseId} 密文解密失败: ${(err as Error).message}`);
      throw new UnauthorizedException(PrecheckErrorCode.SIGNATURE_INVALID);
    }

    const ok = verifyCanonicalRequest({
      secret,
      signature,
      method,
      path,
      timestamp,
      nonce,
      body,
    });
    if (!ok) {
      throw new UnauthorizedException(PrecheckErrorCode.SIGNATURE_INVALID);
    }

    // nonce 防重放
    const cacheKey = `${licenseKey}:${nonce}`;
    const fresh = this.nonceCache.checkAndStore(cacheKey, LicenseService.NONCE_TTL_MS);
    if (!fresh) {
      throw new UnauthorizedException(PrecheckErrorCode.NONCE_REPLAYED);
    }

    // 成功：更新 last_seen_at（失败不中断响应）
    this.conn
      .update(licensesTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(licensesTable.id, row.licenseId))
      .catch((err) => {
        this.logger.warn(`license ${row.licenseId} last_seen_at 更新失败: ${(err as Error).message}`);
      });

    return {
      customerName: row.customerName,
      serverTime: now,
    };
  }

  /**
   * 供 AgentGateway 握手复用的校验变体。
   * 不抛 HTTP 异常（WebSocket 握手阶段无法返回 HTTP body），以 result 对象回传。
   * 成功时返回 licenseId + customerId + customerName 供 AgentService 直接 upsert。
   */
  async verifyPrecheckForHandshake(params: {
    licenseKey: string;
    timestamp: string;
    nonce: string;
    signature: string;
  }): Promise<
    | { ok: true; licenseId: number; customerId: number; customerName: string }
    | { ok: false; code: 'BAD_REQUEST' | 'CLOCK_SKEW' | 'KEY_NOT_FOUND' | 'LICENSE_REVOKED' | 'CUSTOMER_SUSPENDED' | 'SIGNATURE_INVALID' | 'NONCE_REPLAYED' }
  > {
    const { licenseKey, timestamp, nonce, signature } = params;

    if (!licenseKey || !isValidLicenseKeyFormat(licenseKey)) return { ok: false, code: 'BAD_REQUEST' };
    if (!/^\d{10,16}$/.test(timestamp)) return { ok: false, code: 'BAD_REQUEST' };
    if (!/^[0-9a-f]{32}$/i.test(nonce)) return { ok: false, code: 'BAD_REQUEST' };
    if (!/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, code: 'BAD_REQUEST' };

    const ts = Number(timestamp);
    if (Math.abs(Date.now() - ts) > LicenseService.CLOCK_SKEW_MS) return { ok: false, code: 'CLOCK_SKEW' };

    const row = await this.findActiveByKey(licenseKey);
    if (!row) return { ok: false, code: 'KEY_NOT_FOUND' };
    if (row.licenseRevokedAt) return { ok: false, code: 'LICENSE_REVOKED' };
    if (row.customerStatus !== 'active') return { ok: false, code: 'CUSTOMER_SUSPENDED' };

    let secret: string;
    try {
      secret = aesGcmDecryptFromBase64(row.secretCipher, this.encKey);
    } catch (err) {
      this.logger.error(`license ${row.licenseId} 密文解密失败: ${(err as Error).message}`);
      return { ok: false, code: 'SIGNATURE_INVALID' };
    }

    const ok = verifyCanonicalRequest({
      secret, signature, method: 'CONNECT', path: '/agent', timestamp, nonce, body: '',
    });
    if (!ok) return { ok: false, code: 'SIGNATURE_INVALID' };

    // nonce 已校验过格式，这里复用 NonceCacheService
    const nonceKey = `${licenseKey}:${nonce}`;
    if (!this.nonceCache.checkAndStore(nonceKey, LicenseService.NONCE_TTL_MS)) {
      return { ok: false, code: 'NONCE_REPLAYED' };
    }

    return { ok: true, licenseId: row.licenseId, customerId: row.customerId, customerName: row.customerName };
  }

  /**
   * 为已有客户的现役 license 回显 install 命令（secret 需 reveal 权限，从 DB 解密）。
   * 若客户无现役 license 返回 null。
   */
  async getInstallCommand(customerId: number): Promise<string | null> {
    const rows = await this.conn
      .select({
        licenseKey: licensesTable.licenseKey,
        secretCipher: licensesTable.secretCipher,
      })
      .from(licensesTable)
      .where(
        and(
          eq(licensesTable.customerId, customerId),
          isNull(licensesTable.revokedAt),
        ),
      )
      .orderBy(desc(licensesTable.id))
      .limit(1);
    if (rows.length === 0) return null;
    const secret = aesGcmDecryptFromBase64(rows[0].secretCipher, this.encKey);
    return this.buildInstallCommand(rows[0].licenseKey, secret);
  }
}
