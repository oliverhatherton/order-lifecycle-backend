import type { Redis } from 'ioredis';
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
});
