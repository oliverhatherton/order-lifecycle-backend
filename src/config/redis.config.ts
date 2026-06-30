import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  /** Redis connection URL. */
  url: string;
  /** Default cache entry lifetime, in seconds — a safety net behind explicit invalidation. */
  ttlSeconds: number;
}

export default registerAs(
  'redis',
  (): RedisConfig => ({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    ttlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 60),
  }),
);
