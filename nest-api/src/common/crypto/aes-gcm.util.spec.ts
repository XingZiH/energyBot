import { randomBytes } from 'crypto';
import {
  aesGcmDecrypt,
  aesGcmDecryptFromBase64,
  aesGcmEncrypt,
  aesGcmEncryptToBase64,
  loadKeyFromBase64,
} from './aes-gcm.util';

describe('AES-256-GCM 加解密', () => {
  const key = randomBytes(32);

  it('加密两次 IV 不同（输出不同）', () => {
    const a = aesGcmEncrypt('hello', key);
    const b = aesGcmEncrypt('hello', key);
    expect(a.equals(b)).toBe(false);
  });

  it('往返一致（ASCII）', () => {
    const pt = 'hello-license-secret';
    expect(aesGcmDecrypt(aesGcmEncrypt(pt, key), key)).toBe(pt);
  });

  it('往返一致（UTF-8 多字节）', () => {
    const pt = '中文 license 🔑 密钥';
    expect(aesGcmDecrypt(aesGcmEncrypt(pt, key), key)).toBe(pt);
  });

  it('错误密钥解密抛错', () => {
    const ct = aesGcmEncrypt('secret', key);
    const otherKey = randomBytes(32);
    expect(() => aesGcmDecrypt(ct, otherKey)).toThrow();
  });

  it('篡改密文任一字节触发 tag 验证失败', () => {
    const ct = aesGcmEncrypt('secret', key);
    // 改中间某字节（避免刚好改成相同值，循环重试）
    const mid = 16;
    ct[mid] = ct[mid] ^ 0xff;
    expect(() => aesGcmDecrypt(ct, key)).toThrow();
  });

  it('密文过短抛错', () => {
    expect(() => aesGcmDecrypt(Buffer.alloc(10), key)).toThrow(/长度不足/);
  });

  it('密钥长度不为 32 字节抛错', () => {
    expect(() => aesGcmEncrypt('x', Buffer.alloc(16))).toThrow();
    expect(() => aesGcmDecrypt(Buffer.alloc(50), Buffer.alloc(16))).toThrow();
  });

  it('base64 便捷方法往返一致', () => {
    const pt = 'license-secret-plain';
    const b64 = aesGcmEncryptToBase64(pt, key);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(aesGcmDecryptFromBase64(b64, key)).toBe(pt);
  });

  it('loadKeyFromBase64 合法输入', () => {
    const k = loadKeyFromBase64(randomBytes(32).toString('base64'));
    expect(k.length).toBe(32);
  });

  it('loadKeyFromBase64 长度不对抛错', () => {
    expect(() => loadKeyFromBase64(randomBytes(16).toString('base64'))).toThrow(
      /32 字节/,
    );
    expect(() => loadKeyFromBase64('')).toThrow(/32 字节/);
  });

  it('60 字节明文（典型 license secret）加密后 base64 长度 < 200', () => {
    const secret = randomBytes(32).toString('base64url'); // 43 chars
    const b64 = aesGcmEncryptToBase64(secret, key);
    expect(b64.length).toBeLessThan(200);
  });
});
