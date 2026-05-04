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
 * precheck 公共核心的统一返回类型：
 * - ok:true 携带成功路径所需的三字段
 * - ok:false 携带 PrecheckErrorCode（wire format 小写）
 *
 * 导出供 AgentGateway（任务 6/7）直接消费 verifyPrecheckForHandshake 做 narrow。
 */
export type PrecheckResult =
  | { ok: true; licenseId: number; customerId: number; customerName: string }
  | { ok: false; code: PrecheckErrorCode };

/**
 * HTTP 异常分派映射表（verifyPrecheck 用）。
 * 用 Record<PrecheckErrorCode, ...> 让枚举和异常类型在 TS 层面绑死——
 * 未来若给 PrecheckErrorCode 新增成员而忘了补这里，会直接编译失败。
 */
const PRECHECK_CODE_TO_EXCEPTION: Record<
  PrecheckErrorCode,
  new (msg: string) => Error
> = {
  [PrecheckErrorCode.BAD_REQUEST]: BadRequestException,
  [PrecheckErrorCode.LICENSE_REVOKED]: ForbiddenException,
  [PrecheckErrorCode.CUSTOMER_SUSPENDED]: ForbiddenException,
  [PrecheckErrorCode.CLOCK_SKEW]: UnauthorizedException,
  [PrecheckErrorCode.KEY_NOT_FOUND]: UnauthorizedException,
  [PrecheckErrorCode.SIGNATURE_INVALID]: UnauthorizedException,
  [PrecheckErrorCode.NONCE_REPLAYED]: UnauthorizedException,
};

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
   * precheck 公共核心：前 7 步校验（格式 / 时钟 / DB 查 / revoked / suspended / HMAC / nonce）。
   * 供 verifyPrecheck（HTTP 变种）与 verifyPrecheckForHandshake（WSS 变种）复用。
   *
   * 命名用 run 而非 assert——assert* 在 Node/TS 惯例隐含"失败抛异常"，
   * 而本方法失败是返回 { ok:false, code }，用 run 语义更贴合。
   */
  private async runPrecheckCore(params: {
    licenseKey: string;
    timestamp: string;
    nonce: string;
    signature: string;
    method: string;
    path: string;
    body: string;
  }): Promise<PrecheckResult> {
    const { licenseKey, timestamp, nonce, signature, method, path, body } =
      params;

    // 1) 基本格式
    if (!licenseKey || !isValidLicenseKeyFormat(licenseKey)) {
      return { ok: false, code: PrecheckErrorCode.BAD_REQUEST };
    }
    if (!/^\d{10,16}$/.test(timestamp)) {
      return { ok: false, code: PrecheckErrorCode.BAD_REQUEST };
    }
    if (!/^[0-9a-f]{32}$/i.test(nonce)) {
      return { ok: false, code: PrecheckErrorCode.BAD_REQUEST };
    }
    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      return { ok: false, code: PrecheckErrorCode.BAD_REQUEST };
    }

    // 2) 时钟偏移
    const ts = Number(timestamp);
    if (Math.abs(Date.now() - ts) > LicenseService.CLOCK_SKEW_MS) {
      return { ok: false, code: PrecheckErrorCode.CLOCK_SKEW };
    }

    // 3) 查 license + 4) revoked + 5) suspended
    const row = await this.findActiveByKey(licenseKey);
    if (!row) return { ok: false, code: PrecheckErrorCode.KEY_NOT_FOUND };
    if (row.licenseRevokedAt) {
      return { ok: false, code: PrecheckErrorCode.LICENSE_REVOKED };
    }
    if (row.customerStatus !== 'active') {
      return { ok: false, code: PrecheckErrorCode.CUSTOMER_SUSPENDED };
    }

    // 6) 解密 secret + 验签
    let secret: string;
    try {
      secret = aesGcmDecryptFromBase64(row.secretCipher, this.encKey);
    } catch (err) {
      // 密文损坏或密钥不对——属于服务端配置问题
      this.logger.error(
        `license ${row.licenseId} 密文解密失败: ${(err as Error).message}`,
      );
      return { ok: false, code: PrecheckErrorCode.SIGNATURE_INVALID };
    }

    const sigOk = verifyCanonicalRequest({
      secret,
      signature,
      method,
      path,
      timestamp,
      nonce,
      body,
    });
    if (!sigOk) return { ok: false, code: PrecheckErrorCode.SIGNATURE_INVALID };

    // 7) nonce 防重放
    const nonceKey = `${licenseKey}:${nonce}`;
    if (!this.nonceCache.checkAndStore(nonceKey, LicenseService.NONCE_TTL_MS)) {
      return { ok: false, code: PrecheckErrorCode.NONCE_REPLAYED };
    }

    return {
      ok: true,
      licenseId: row.licenseId,
      customerId: row.customerId,
      customerName: row.customerName,
    };
  }

  /**
   * 客户端 precheck 总入口（HTTP 变种）。任一失败抛 HTTP 异常，异常消息里带标准错误码
   * （PrecheckErrorCode 值字符串）供 install.sh 做差异化提示。
   *
   * 成功则返回 { customerName, serverTime } 并异步更新 last_seen_at（失败不中断响应）。
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
    const res = await this.runPrecheckCore(params);
    // 用 === false 而非 !res.ok：仓库 tsconfig strictNullChecks:false 下
    // `!res.ok` 无法把 res 窄化到 { ok:false, code }（undefined/null 也 truthy 反面）。
    if (res.ok === false) {
      const ExceptionClass = PRECHECK_CODE_TO_EXCEPTION[res.code];
      throw new ExceptionClass(res.code);
    }

    // 成功：异步更新 last_seen_at（失败不中断响应）
    this.conn
      .update(licensesTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(licensesTable.id, res.licenseId))
      .catch((err) => {
        this.logger.warn(
          `license ${res.licenseId} last_seen_at 更新失败: ${(err as Error).message}`,
        );
      });

    // serverTime 在成功分派后重取（重构前是 skew 校验时的 now，差几 ms）。
    // install.sh 只做展示用途，差异在噪声范围内。
    return {
      customerName: res.customerName,
      serverTime: Date.now(),
    };
  }

  /**
   * 供 AgentGateway 握手复用的校验变体（WSS）。
   * 不抛 HTTP 异常（WebSocket 握手阶段无法返回 HTTP body），以 result 对象回传。
   * 成功时返回 licenseId + customerId + customerName 供 AgentService 直接 upsert。
   */
  async verifyPrecheckForHandshake(params: {
    licenseKey: string;
    timestamp: string;
    nonce: string;
    signature: string;
  }): Promise<PrecheckResult> {
    return this.runPrecheckCore({
      ...params,
      method: 'CONNECT',
      path: '/agent',
      body: '',
    });
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
