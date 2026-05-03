import { NonceCacheService } from './nonce-cache.service';

describe('NonceCacheService', () => {
  let svc: NonceCacheService;

  beforeEach(() => {
    svc = new NonceCacheService();
    svc.setMaxEntriesForTesting(5); // 小容量便于测 LRU
  });

  it('首次存储返回 true', () => {
    expect(svc.checkAndStore('k1', 60_000)).toBe(true);
  });

  it('重复存储返回 false', () => {
    svc.checkAndStore('k1', 60_000);
    expect(svc.checkAndStore('k1', 60_000)).toBe(false);
  });

  it('TTL 过期后允许相同 key', () => {
    jest.useFakeTimers();
    try {
      svc.checkAndStore('k1', 1_000);
      jest.advanceTimersByTime(1_001);
      expect(svc.checkAndStore('k1', 1_000)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('超容量淘汰最旧 entry', () => {
    for (let i = 0; i < 5; i++) svc.checkAndStore(`k${i}`, 60_000);
    expect(svc.size()).toBe(5);
    svc.checkAndStore('k5', 60_000);
    expect(svc.size()).toBe(5);
    // k0 被淘汰 → 再存允许返回 true
    expect(svc.checkAndStore('k0', 60_000)).toBe(true);
  });

  it('purgeExpired 清理过期 entry 返回清理数', () => {
    jest.useFakeTimers();
    try {
      svc.checkAndStore('a', 1_000);
      svc.checkAndStore('b', 10_000);
      jest.advanceTimersByTime(2_000);
      const removed = svc.purgeExpired();
      expect(removed).toBe(1);
      expect(svc.size()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clear 清空所有', () => {
    svc.checkAndStore('a', 60_000);
    svc.checkAndStore('b', 60_000);
    svc.clear();
    expect(svc.size()).toBe(0);
    expect(svc.checkAndStore('a', 60_000)).toBe(true);
  });
});
