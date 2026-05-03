import { Injectable } from '@nestjs/common';

/**
 * 进程内 nonce 缓存。防止 HMAC 签名请求被重放。
 *
 * 设计取舍：
 * - 不持久化：进程重启后 nonce 重置，但因有 5 分钟时钟偏移窗口，窗口内的 nonce 若重启前被用过、
 *   重启后再次提交会被放行——这是可接受的边界（攻击者需在 ≤5 分钟内重放且恰逢重启）。
 * - 内存 Map + 过期时间：O(1) 查询；超容量 LRU 按插入顺序淘汰最旧。
 * - JS 单线程天然并发安全，无需锁。
 */
@Injectable()
export class NonceCacheService {
  private readonly cache = new Map<string, number>();
  private readonly maxEntries: number;

  constructor(maxEntries = 100_000) {
    this.maxEntries = maxEntries;
  }

  /**
   * 原子性地"检查并存储"：若 key 不存在则存入并返回 true；若已存在（未过期）返回 false。
   *
   * @param key 缓存 key（建议用 `${licenseKey}:${nonce}` 隔离不同租户）
   * @param ttlMs 有效期毫秒
   */
  checkAndStore(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing !== undefined && existing > now) {
      return false;
    }
    this.cache.set(key, now + ttlMs);
    // Map 按插入顺序迭代，迭代器第一个就是最旧条目——超容量时淘汰
    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    return true;
  }

  /**
   * 清理所有已过期 entry；建议挂定时器每 N 分钟调一次，避免内存持续膨胀。
   * 测试或运维需要手动清空时也可用。
   */
  purgeExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, expireAt] of this.cache.entries()) {
      if (expireAt <= now) {
        this.cache.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** 当前 entry 数量（主要供测试用）。 */
  size(): number {
    return this.cache.size;
  }

  /** 清空所有 entry（主要供测试用）。 */
  clear(): void {
    this.cache.clear();
  }
}
