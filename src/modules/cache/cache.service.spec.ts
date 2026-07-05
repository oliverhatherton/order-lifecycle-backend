import type { Redis } from 'ioredis';
import { register } from 'prom-client';
import { CacheService } from '@/modules/cache/cache.service';

describe('CacheService', () => {
  function build(redis: Partial<Redis>): CacheService {
    return new CacheService(redis as Redis);
  }

  describe('get', () => {
    it('parses and returns a stored JSON value', async () => {
      const service = build({
        get: jest.fn().mockResolvedValue(JSON.stringify({ a: 1 })),
      });

      await expect(service.get<{ a: number }>('k')).resolves.toEqual({ a: 1 });
    });

    it('returns undefined on a miss', async () => {
      const service = build({ get: jest.fn().mockResolvedValue(null) });

      await expect(service.get('k')).resolves.toBeUndefined();
    });

    it('fails open (undefined) when Redis errors', async () => {
      const service = build({
        get: jest.fn().mockRejectedValue(new Error('down')),
      });

      await expect(service.get('k')).resolves.toBeUndefined();
    });
  });

  describe('set', () => {
    it('stores the value as JSON with an EX ttl', async () => {
      const set = jest.fn().mockResolvedValue('OK');
      const service = build({ set });

      await service.set('k', { a: 1 }, 30);

      expect(set).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), 'EX', 30);
    });

    it('fails open when Redis errors', async () => {
      const service = build({
        set: jest.fn().mockRejectedValue(new Error('down')),
      });

      await expect(service.set('k', {}, 30)).resolves.toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('counts hits and misses per key class and overall', async () => {
      const store: Record<string, string> = { 'order:1': JSON.stringify({}) };
      const service = build({
        get: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
      });

      await service.get('order:1'); // hit
      await service.get('order:2'); // miss
      await service.get('orders:user:7'); // miss

      const stats = service.getStats();
      expect(stats.byClass.order).toEqual({ hits: 1, misses: 1, hitRate: 0.5 });
      expect(stats.byClass.orders).toEqual({ hits: 0, misses: 1, hitRate: 0 });
      expect(stats.overall).toEqual({
        hits: 1,
        misses: 2,
        hitRate: 1 / 3,
      });
    });

    it('counts a Redis error as a miss', async () => {
      const service = build({
        get: jest.fn().mockRejectedValue(new Error('down')),
      });

      await service.get('order:1');

      expect(service.getStats().byClass.order).toEqual({
        hits: 0,
        misses: 1,
        hitRate: 0,
      });
    });
  });

  describe('del', () => {
    it('removes the given keys', async () => {
      const del = jest.fn().mockResolvedValue(2);
      const service = build({ del });

      await service.del('a', 'b');

      expect(del).toHaveBeenCalledWith('a', 'b');
    });

    it('is a no-op when given no keys', async () => {
      const del = jest.fn();
      const service = build({ del });

      await service.del();

      expect(del).not.toHaveBeenCalled();
    });

    it('fails open when Redis errors', async () => {
      const service = build({
        del: jest.fn().mockRejectedValue(new Error('down')),
      });

      await expect(service.del('a')).resolves.toBeUndefined();
    });
  });

  describe('when disabled', () => {
    it('never touches Redis: reads miss, writes and deletes are no-ops', async () => {
      const redis = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };
      const service = new CacheService(redis as unknown as Redis, false);

      await expect(service.get('order:1')).resolves.toBeUndefined();
      await service.set('order:1', { a: 1 }, 30);
      await service.del('order:1');

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('Prometheus export', () => {
    async function counter(result: 'hit' | 'miss'): Promise<number> {
      const metric = await register
        .getSingleMetric('cache_requests_total')!
        .get();
      return (
        metric.values.find(
          (v) =>
            v.labels.key_class === 'promtest' && v.labels.result === result,
        )?.value ?? 0
      );
    }

    it('counts hits and misses by key class on cache_requests_total', async () => {
      const [hitsBefore, missesBefore] = [
        await counter('hit'),
        await counter('miss'),
      ];
      const service = build({
        get: jest.fn().mockResolvedValueOnce('{}').mockResolvedValueOnce(null),
      });

      await service.get('promtest:1');
      await service.get('promtest:2');

      expect((await counter('hit')) - hitsBefore).toBe(1);
      expect((await counter('miss')) - missesBefore).toBe(1);
    });
  });
});
