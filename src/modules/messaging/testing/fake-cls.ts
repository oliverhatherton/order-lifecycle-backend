import { ClsService } from 'nestjs-cls';

/**
 * Minimal in-process ClsService stand-in for consumer/publisher unit tests:
 * `run` invokes the callback synchronously in a Map-backed store, so correlation
 * wrapping is exercised without the real AsyncLocalStorage machinery.
 */
export function fakeCls(): ClsService {
  const store = new Map<string, unknown>();
  return {
    run: <T>(callback: () => T): T => callback(),
    set: (key: string, value: unknown): void => {
      store.set(key, value);
    },
    get: (key: string): unknown => store.get(key),
    isActive: (): boolean => true,
    getId: (): string => 'test-correlation-id',
  } as unknown as ClsService;
}
