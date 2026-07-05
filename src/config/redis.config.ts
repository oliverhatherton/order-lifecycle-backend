import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  /** Redis connection URL. */
  url: string;
  /** Default cache entry lifetime, in seconds — a safety net behind explicit invalidation. */
  ttlSeconds: number;
  /**
   * Master switch for cache-aside reads. `CACHE_ENABLED=false` makes every
   * read a straight DB hit — used to A/B the cache under load (ops/load-test.k6.js).
   */
  enabled: boolean;
}

export default registerAs(
  'redis',
  (): RedisConfig => ({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    ttlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 60),
    enabled: process.env.CACHE_ENABLED !== 'false',
  }),
);
