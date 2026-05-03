import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 从 base64 字符串（如 `openssl rand -base64 32` 的输出）加载 32 字节密钥。
 *
 * @throws 若解码后长度 ≠ 32
 */
export function loadKeyFromBase64(input: string): Buffer {
  const key = Buffer.from(input, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AES-256-GCM 密钥必须为 32 字节（base64 解码后），实际得到 ${key.length} 字节`,
    );
  }
  return key;
}

/**
 * 用 AES-256-GCM 加密明文字符串。
 *
 * 输出格式（单个 Buffer 拼接）：`iv(12B) || ciphertext(变长) || tag(16B)`。
 * 调用方通常会再 base64 编码后存 DB。
 */
export function aesGcmEncrypt(plaintext: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`密钥长度必须为 ${KEY_BYTES} 字节`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

/**
 * 解密 `aesGcmEncrypt` 的输出。
 *
 * @throws 若密钥错、密文被篡改、或长度不足
 */
export function aesGcmDecrypt(packed: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`密钥长度必须为 ${KEY_BYTES} 字节`);
  }
  if (packed.length < IV_BYTES + TAG_BYTES) {
    throw new Error('密文长度不足');
  }
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(packed.length - TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES, packed.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * 便捷组合：加密 → base64 字符串（可直接存 varchar 列）。
 */
export function aesGcmEncryptToBase64(plaintext: string, key: Buffer): string {
  return aesGcmEncrypt(plaintext, key).toString('base64');
}

/**
 * 便捷组合：从 base64 字符串解密回明文。
 */
export function aesGcmDecryptFromBase64(
  packedBase64: string,
  key: Buffer,
): string {
  return aesGcmDecrypt(Buffer.from(packedBase64, 'base64'), key);
}
