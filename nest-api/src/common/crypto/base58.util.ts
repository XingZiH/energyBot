/**
 * Base58 编码 / 解码工具（Bitcoin 字母表）
 *
 * 字母表剔除易混淆字符：0（零）、O（大写 O）、I（大写 I）、l（小写 L）。
 * 用于生成人类可读的 license key 明文部分，避免客户复制粘贴时混淆。
 *
 * 参考：https://en.bitcoin.it/wiki/Base58Check_encoding
 */

const ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET[i]] = i;
}

/**
 * 将 Buffer 编码为 base58 字符串。
 *
 * @param input 原始字节
 * @returns base58 字符串；空输入返回空串
 */
export function base58Encode(input: Buffer): string {
  if (input.length === 0) return '';

  // 统计开头 0 字节数量（映射为前导 "1"）
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) {
    zeros++;
  }

  // 将整个字节数组当作大整数做 base58 除法
  const digits: number[] = [0];
  for (let i = zeros; i < input.length; i++) {
    let carry = input[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = '';
  for (let i = 0; i < zeros; i++) result += '1';
  // 当输入全为 0 字节时，digits 始终为 [0]，不应输出额外字符
  if (zeros < input.length) {
    for (let i = digits.length - 1; i >= 0; i--) {
      result += ALPHABET[digits[i]];
    }
  }
  return result;
}

/**
 * 将 base58 字符串解码回 Buffer。
 *
 * @param input base58 字符串
 * @returns 原始字节；空输入返回空 Buffer
 * @throws 若遇到非法字符（不在字母表内）
 */
export function base58Decode(input: string): Buffer {
  if (input.length === 0) return Buffer.alloc(0);

  let zeros = 0;
  while (zeros < input.length && input[zeros] === '1') {
    zeros++;
  }

  const bytes: number[] = [0];
  for (let i = zeros; i < input.length; i++) {
    const value = ALPHABET_MAP[input[i]];
    if (value === undefined) {
      throw new Error(`非法 base58 字符: "${input[i]}"`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = Buffer.alloc(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + i] = bytes[bytes.length - 1 - i];
  }
  // 纯 "1...1" 输入时 bytes=[0]，需裁掉末尾的多余 0
  if (zeros === input.length) {
    return out.subarray(0, zeros);
  }
  return out;
}
