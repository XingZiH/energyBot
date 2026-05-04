/**
 * 一次性脚本：生成 HMAC fixture。Nest 单测 + Go 单测都读此 JSON。
 *
 * ⚠️ 本文件及产出的 hmac-pairs.json 中所有 secret 均为测试桩值，
 *    与生产 license/agent secret 无关，不构成泄露。
 *
 * 运行：pnpm ts-node test/fixtures/generate-hmac-pairs.ts > test/fixtures/hmac-pairs.json
 */
import { signCanonicalRequest } from '../../src/common/crypto/hmac.util';

const cases = [
  { secret: 'test-secret-000', method: 'CONNECT', path: '/agent', body: '' },
  { secret: 'test-secret-001', method: 'GET', path: '/agent/my-bot', body: '' },
  { secret: 'aBc_XYZ-with.special~chars', method: 'POST', path: '/agent', body: '{"hello":"world"}' },
  { secret: 'secret-with-unicode-❤', method: 'CONNECT', path: '/agent', body: '' },
  { secret: '0', method: 'CONNECT', path: '/agent', body: '' },
  { secret: 'x'.repeat(64), method: 'POST', path: '/agent/heartbeat', body: '{"uptime":12345,"cpuPercent":12.34}' },
  { secret: 'ascii-only', method: 'CONNECT', path: '/agent', body: '' },
  { secret: 'test', method: 'GET', path: '/agent?foo=bar', body: '' },   // 规范串里 path 原样
  { secret: 'test', method: 'POST', path: '/agent', body: 'a' },         // 1 字节 body
  { secret: 'test', method: 'CONNECT', path: '/agent', body: '' },       // 边界最小
];

const out = cases.map((c, i) => {
  const ts = (1714800000000 + i * 1000).toString();  // 固定时间戳可重放
  const nonce = i.toString(16).padStart(32, '0');    // 固定 nonce
  const signature = signCanonicalRequest({
    secret: c.secret, method: c.method, path: c.path,
    timestamp: ts, nonce, body: c.body,
  });
  return { ...c, timestamp: ts, nonce, signature };
});

console.log(JSON.stringify(out, null, 2));
