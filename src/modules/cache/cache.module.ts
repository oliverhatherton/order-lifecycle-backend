import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CacheService } from '@/modules/cache/cache.service';
import { REDIS_CLIENT, redisProvider } from '@/modules/cache/redis.provider';

/**
 * Owns the Redis connection and exposes CacheService application-wide. Global
 * because caching is cross-cutting infrastructure — feature modules inject
 * CacheService without importing this module.
 */
@Global()
@Module({
  providers: [redisProvider, CacheService],
  exports: [CacheService],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
