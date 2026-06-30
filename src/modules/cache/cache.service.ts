import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@/modules/cache/redis.provider';

/**
 * Thin cache-aside helper over Redis. Every operation is **fail-open**: if Redis
 * is unavailable the error is logged and the call degrades to a miss / no-op, so
 * a cache outage costs latency, never correctness or availability. Values are
 * stored as JSON; callers own key naming and any date rehydration.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Returns the cached value for `key`, or `undefined` on a miss or Redis error. */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
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
