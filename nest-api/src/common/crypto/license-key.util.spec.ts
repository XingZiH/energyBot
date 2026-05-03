import {
  generateLicenseKey,
  generateLicenseSecret,
  isValidLicenseKeyFormat,
  LICENSE_KEY_PREFIX,
  LICENSE_KEY_REGEX,
} from './license-key.util';

describe('license-key 生成器', () => {
  it('generateLicenseKey 以 ebt_ 开头', () => {
    const k = generateLicenseKey();
    expect(k.startsWith(LICENSE_KEY_PREFIX)).toBe(true);
  });

  it('generateLicenseKey 符合 regex', () => {
    for (let i = 0; i < 50; i++) {
      expect(LICENSE_KEY_REGEX.test(generateLicenseKey())).toBe(true);
    }
  });

  it('100 次生成唯一', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateLicenseKey());
    expect(set.size).toBe(100);
  });

  it('generateLicenseSecret 是 base64url（43 字符，无 padding）', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateLicenseSecret();
      expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('generateLicenseSecret 100 次唯一', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateLicenseSecret());
    expect(set.size).toBe(100);
  });

  it('isValidLicenseKeyFormat 正确判断', () => {
    expect(isValidLicenseKeyFormat(generateLicenseKey())).toBe(true);
    expect(isValidLicenseKeyFormat('')).toBe(false);
    expect(isValidLicenseKeyFormat('not-a-key')).toBe(false);
    expect(isValidLicenseKeyFormat('ebt_')).toBe(false);
    expect(isValidLicenseKeyFormat('ebt_0OIl' + 'a'.repeat(30))).toBe(false);
  });
});
