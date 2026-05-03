import { base58Decode, base58Encode } from './base58.util';

describe('base58 编解码', () => {
  it('空 Buffer 编码为空串', () => {
    expect(base58Encode(Buffer.alloc(0))).toBe('');
  });

  it('空串解码为空 Buffer', () => {
    expect(base58Decode('').length).toBe(0);
  });

  it('"hello" 编码结果与已知向量一致', () => {
    // Bitcoin 参考字母表对 "hello" (0x68 65 6c 6c 6f) 的编码为 "Cn8eVZg"
    expect(base58Encode(Buffer.from('hello'))).toBe('Cn8eVZg');
  });

  it('已知向量能解码回原值', () => {
    expect(base58Decode('Cn8eVZg').toString()).toBe('hello');
  });

  it('前导 0 字节映射为前导 "1"', () => {
    const input = Buffer.from([0x00, 0x00, 0x01]);
    const encoded = base58Encode(input);
    expect(encoded.startsWith('11')).toBe(true);
    expect(base58Decode(encoded).equals(input)).toBe(true);
  });

  it('24 字节随机数据往返一致', () => {
    for (let trial = 0; trial < 20; trial++) {
      const data = Buffer.alloc(24);
      for (let i = 0; i < 24; i++) data[i] = Math.floor(Math.random() * 256);
      const roundtrip = base58Decode(base58Encode(data));
      expect(roundtrip.equals(data)).toBe(true);
    }
  });

  it('字母表不包含 0 O I l', () => {
    const data = Buffer.from([255, 128, 64, 32, 16, 8, 4, 2, 1]);
    const encoded = base58Encode(data);
    expect(encoded).not.toMatch(/[0OIl]/);
  });

  it('遇到非法字符抛错', () => {
    expect(() => base58Decode('abc0def')).toThrow(/非法 base58 字符/);
    expect(() => base58Decode('abcOdef')).toThrow(/非法 base58 字符/);
    expect(() => base58Decode('abcIdef')).toThrow(/非法 base58 字符/);
    expect(() => base58Decode('abcldef')).toThrow(/非法 base58 字符/);
  });

  it('大 buffer（1KB）往返一致', () => {
    const data = Buffer.alloc(1024);
    for (let i = 0; i < 1024; i++) data[i] = i & 0xff;
    expect(base58Decode(base58Encode(data)).equals(data)).toBe(true);
  });

  it('单字节覆盖所有 0-255 值', () => {
    for (let i = 0; i <= 255; i++) {
      const data = Buffer.from([i]);
      expect(base58Decode(base58Encode(data)).equals(data)).toBe(true);
    }
  });
});
