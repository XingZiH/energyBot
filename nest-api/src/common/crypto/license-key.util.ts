import { randomBytes } from 'crypto';
import { base58Encode } from './base58.util';

/**
 * License key 格式：`ebt_` 前缀 + base58(24 随机字节) ≈ 36-37 字符
 * - 前缀便于日志/告警/代码中识别
 * - 24 字节 = 192 bit 熵，远超可暴力枚举
 */
export const LICENSE_KEY_PREFIX = 'ebt_';
export const LICENSE_KEY_REGEX = /^ebt_[1-9A-HJ-NP-Za-km-z]{30,45}$/;

/**
 * 生成一个新的 license key（明文，客户可见）。
 */
export function generateLicenseKey(): string {
  return LICENSE_KEY_PREFIX + base58Encode(randomBytes(24));
}

/**
 * 生成一个新的 license secret（base64url 编码的 32 随机字节，43 字符）。
 *
 * 用于 HMAC-SHA256 签名密钥。客户首次拿到后只有自己持有明文（install.sh 写入文件 600），
 * 服务端以 AES-GCM 加密存库。
 */
export function generateLicenseSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * 校验字符串是否符合 license key 格式。
 */
export function isValidLicenseKeyFormat(key: string): boolean {
  return LICENSE_KEY_REGEX.test(key);
}
