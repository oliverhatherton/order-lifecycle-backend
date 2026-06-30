import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/** Injection token for the shared ioredis connection. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Provides the singleton ioredis connection. `lazyConnect` keeps construction
 * non-blocking and `maxRetriesPerRequest: null` lets commands fail fast (caught
 * fail-open by CacheService) rather than queueing while the server is down.
 */
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis => {
    const logger = new Logger('RedisClient');
    const url = configService.getOrThrow<string>('redis.url');
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Fail commands fast while disconnected so CacheService degrades to a
      // miss/no-op (fail-open) instead of queueing behind a dead server.
      enableOfflineQueue: false,
    });
    client.on('error', (error: Error) => {
      logger.warn(`Redis connection error: ${error.message}`);
    });
    void client.connect().catch((error: Error) => {
      logger.warn(`Redis initial connect failed: ${error.message}`);
    });
    return client;
  },
};
