import type { Redis } from 'ioredis';

/**
 * Minimal in-memory stand-in for the ioredis client used by suites that don't
 * spin a real Redis container. It implements exactly the surface CacheService
 * touches (`get`/`set`/`del`/`quit`), so caching behaves deterministically
 * in-process without a socket — TTL is ignored (entries live for the suite).
 */
export function createFakeRedis(): Redis {
  const store = new Map<string, string>();

  const fake = {
    get: (key: string): Promise<string | null> =>
      Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string): Promise<'OK'> => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]): Promise<number> => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return Promise.resolve(removed);
    },
    quit: (): Promise<'OK'> => Promise.resolve('OK'),
  };

  return fake as unknown as Redis;
}
