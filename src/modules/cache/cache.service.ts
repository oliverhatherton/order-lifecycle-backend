import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@/modules/cache/redis.provider';

export interface CacheClassStats {
  hits: number;
  misses: number;
  /** hits / (hits + misses); 0 when nothing has been read. */
  hitRate: number;
}

export interface CacheStats {
  /** Counters split by key class (the prefix before the first ':', e.g. `order`). */
  byClass: Record<string, CacheClassStats>;
  overall: CacheClassStats;
}

/** The stats bucket for a key: its prefix before the first ':' (e.g. `order`). */
const keyClass = (key: string): string => key.split(':')[0];

const withRate = (hits: number, misses: number): CacheClassStats => ({
  hits,
  misses,
  hitRate: hits + misses === 0 ? 0 : hits / (hits + misses),
});

/**
 * Thin cache-aside helper over Redis. Every operation is **fail-open**: if Redis
 * is unavailable the error is logged and the call degrades to a miss / no-op, so
 * a cache outage costs latency, never correctness or availability. Values are
 * stored as JSON; callers own key naming and any date rehydration.
 *
 * `get` records a per-key-class hit/miss counter, exposed via {@link getStats}
 * so the effectiveness of the cache is observable (Epic 5 surfaces it as a
 * metric).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly stats = new Map<string, { hits: number; misses: number }>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Returns the cached value for `key`, or `undefined` on a miss or Redis error. */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      this.record(key, raw !== null);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.record(key, false);
      this.logger.warn(
        `Cache get failed for ${key}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /** Stores `value` under `key` with a TTL (seconds). Errors are swallowed. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `Cache set failed for ${key}: ${(error as Error).message}`,
      );
    }
  }

  /** Snapshot of hit/miss counters by key class and overall, with hit rates. */
  getStats(): CacheStats {
    const byClass: Record<string, CacheClassStats> = {};
    let hits = 0;
    let misses = 0;
    for (const [cls, counts] of this.stats) {
      byClass[cls] = withRate(counts.hits, counts.misses);
      hits += counts.hits;
      misses += counts.misses;
    }
    return { byClass, overall: withRate(hits, misses) };
  }

  private record(key: string, hit: boolean): void {
    const cls = keyClass(key);
    const counts = this.stats.get(cls) ?? { hits: 0, misses: 0 };
    if (hit) counts.hits += 1;
    else counts.misses += 1;
    this.stats.set(cls, counts);
  }

  /** Removes one or more keys. Errors are swallowed. */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Cache del failed for ${keys.join(', ')}: ${(error as Error).message}`,
      );
    }
  }
}
