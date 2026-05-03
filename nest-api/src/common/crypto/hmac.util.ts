import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * 空 body 的 SHA256（lowercase hex）。
 *
 * 约定：当请求 body 为空（GET 或空 POST）时，规范串中的 body hash 字段使用此常量，
 * 而不是对空串求 hash（结果相同但显式化更清楚）。
 */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * 生成 HTTP 请求的规范串并用 HMAC-SHA256 签名。
 *
 * 规范串格式（每段之间换行）：
 * ```
 * METHOD\n
 * PATH\n
 * TIMESTAMP_MS\n
 * NONCE_HEX\n
 * SHA256_OF_BODY_HEX
 * ```
 *
 * - METHOD 固定大写（GET/POST/…）
 * - PATH 为请求路径（不含 query string 和域名）
 * - TIMESTAMP_MS 客户端本地 Unix 毫秒（字符串形式，便于脚本实现）
 * - NONCE_HEX 16 字节随机数的 hex 编码
 * - body hash 使用 SHA256(body, hex, lowercase)；空 body 用 EMPTY_BODY_SHA256
 *
 * @returns 64 字符的 lowercase hex 签名
 */
export function signCanonicalRequest(params: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string | Buffer;
}): string {
  const { secret, method, path, timestamp, nonce, body } = params;
  const bodyHash = hashBody(body);
  const canonical = buildCanonicalString(method, path, timestamp, nonce, bodyHash);
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * 验证签名是否匹配（timing-safe）。
 *
 * 对长度不一致的签名直接返回 false，不抛错。
 */
export function verifyCanonicalRequest(params: {
  secret: string;
  signature: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string | Buffer;
}): boolean {
  const expected = signCanonicalRequest(params);
  if (expected.length !== params.signature.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(params.signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

function hashBody(body: string | Buffer): string {
  if ((typeof body === 'string' && body.length === 0) ||
      (Buffer.isBuffer(body) && body.length === 0)) {
    return EMPTY_BODY_SHA256;
  }
  return createHash('sha256').update(body).digest('hex');
}

function buildCanonicalString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}
