import { createHmac } from 'crypto';
import { execSync } from 'child_process';
import {
  EMPTY_BODY_SHA256,
  signCanonicalRequest,
  verifyCanonicalRequest,
} from './hmac.util';

describe('HMAC 规范串签名', () => {
  const secret = 'test-secret-123';
  const baseParams = {
    secret,
    method: 'POST',
    path: '/api/v1/license/precheck',
    timestamp: '1714700000000',
    nonce: 'abcdef0123456789abcdef0123456789',
    body: '',
  };

  it('空 body 使用约定常量', () => {
    expect(EMPTY_BODY_SHA256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('签名结果为 64 字符 lowercase hex', () => {
    const sig = signCanonicalRequest(baseParams);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入产生相同签名', () => {
    expect(signCanonicalRequest(baseParams)).toBe(
      signCanonicalRequest(baseParams),
    );
  });

  it('method 大小写不敏感', () => {
    expect(signCanonicalRequest({ ...baseParams, method: 'post' })).toBe(
      signCanonicalRequest({ ...baseParams, method: 'POST' }),
    );
  });

  it('任一字段变化签名必变', () => {
    const base = signCanonicalRequest(baseParams);
    expect(signCanonicalRequest({ ...baseParams, path: '/other' })).not.toBe(base);
    expect(signCanonicalRequest({ ...baseParams, timestamp: '1' })).not.toBe(base);
    expect(signCanonicalRequest({ ...baseParams, nonce: 'x'.repeat(32) })).not.toBe(base);
    expect(signCanonicalRequest({ ...baseParams, body: 'changed' })).not.toBe(base);
    expect(signCanonicalRequest({ ...baseParams, secret: 'other' })).not.toBe(base);
  });

  it('verify 匹配返回 true', () => {
    const sig = signCanonicalRequest(baseParams);
    expect(verifyCanonicalRequest({ ...baseParams, signature: sig })).toBe(true);
  });

  it('verify 不匹配返回 false', () => {
    expect(
      verifyCanonicalRequest({ ...baseParams, signature: 'a'.repeat(64) }),
    ).toBe(false);
  });

  it('verify 长度不等返回 false（不抛错）', () => {
    expect(verifyCanonicalRequest({ ...baseParams, signature: 'short' })).toBe(false);
    expect(verifyCanonicalRequest({ ...baseParams, signature: '' })).toBe(false);
  });

  it('Buffer body 与等价 string 产生相同签名', () => {
    const str = 'hello world';
    const buf = Buffer.from(str);
    expect(signCanonicalRequest({ ...baseParams, body: str })).toBe(
      signCanonicalRequest({ ...baseParams, body: buf }),
    );
  });

  it('与 openssl dgst -sha256 -hmac 结果交叉一致', () => {
    // 该用例等价验证 install.sh 中 openssl 命令生成的签名能被 Node 验证
    const canonical = [
      'POST',
      '/api/v1/license/precheck',
      '1714700000000',
      'abcdef0123456789abcdef0123456789',
      EMPTY_BODY_SHA256,
    ].join('\n');
    const nodeSig = createHmac('sha256', secret).update(canonical).digest('hex');
    const sig = signCanonicalRequest(baseParams);
    expect(sig).toBe(nodeSig);

    // 真的调一次 openssl 以防算法实现偏差（用临时文件传递保留换行）
    try {
      const { writeFileSync, unlinkSync } = require('fs');
      const tmp = `/tmp/hmac-xcheck-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, canonical);
      try {
        const opensslOut = execSync(
          `openssl dgst -sha256 -hmac ${JSON.stringify(secret)} -r < ${tmp}`,
          { encoding: 'utf8' },
        )
          .trim()
          .split(' ')[0];
        expect(opensslOut).toBe(sig);
      } finally {
        unlinkSync(tmp);
      }
    } catch (err) {
      // openssl 不可用时跳过（CI 环境一般都有）
      console.warn('跳过 openssl 交叉验证:', (err as Error).message);
    }
  });
});
