import type { ModuleRef } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { register } from 'prom-client';
import {
  LiveGaugesService,
  MONITORED_QUEUES,
} from '@/modules/metrics/live-gauges.service';

describe('LiveGaugesService', () => {
  const query = jest.fn();
  const dataSource = { query } as unknown as DataSource;

  function moduleRefWith(channel?: { checkQueue: jest.Mock }): ModuleRef {
    return {
      get: jest.fn(() => {
        if (!channel) throw new Error('no AmqpConnection');
        return {
          connection: {
            createChannel: jest.fn().mockResolvedValue({
              ...channel,
              on: jest.fn(),
              close: jest.fn().mockResolvedValue(undefined),
            }),
          },
        };
      }),
    } as unknown as ModuleRef;
  }

  function scriptDb(): void {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('"orders"')
          ? [
              { status: 'PENDING', count: '2' },
              { status: 'COMPLETED', count: '7' },
            ]
          : [{ pending: '3', age: '4.5' }],
      ),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    scriptDb();
  });

  it('zero-fills every order status and reports the outbox backlog', async () => {
    const service = new LiveGaugesService(dataSource, moduleRefWith());

    const snapshot = await service.snapshot();

    expect(snapshot.ordersByStatus).toEqual({
      PENDING: 2,
      RESERVED: 0,
      PAID: 0,
      COMPLETED: 7,
      FAILED: 0,
      CANCELLED: 0,
    });
    expect(snapshot.outboxPending).toBe(3);
    expect(snapshot.outboxOldestAgeSeconds).toBe(4.5);
  });

  it('reuses one snapshot across the gauges of a single scrape', async () => {
    const service = new LiveGaugesService(dataSource, moduleRefWith());

    await Promise.all([service.snapshot(), service.snapshot()]);

    expect(query).toHaveBeenCalledTimes(2); // orders + outbox, once each
  });

  it('exports DB gauges and no queue gauges when there is no broker', async () => {
    const service = new LiveGaugesService(dataSource, moduleRefWith());

    const snapshot = await service.snapshot();

    expect(snapshot.queues).toEqual([]);
  });

  it('reports depth and consumers per monitored queue, skipping ones the broker rejects', async () => {
    const checkQueue = jest.fn((queue: string) =>
      queue === MONITORED_QUEUES[0]
        ? Promise.reject(new Error('NOT_FOUND'))
        : Promise.resolve({ messageCount: 1, consumerCount: 2 }),
    );
    const service = new LiveGaugesService(
      dataSource,
      moduleRefWith({ checkQueue }),
    );

    const snapshot = await service.snapshot();

    expect(snapshot.queues.map((q) => q.queue)).toEqual(
      MONITORED_QUEUES.slice(1),
    );
    expect(snapshot.queues[0]).toMatchObject({ messages: 1, consumers: 2 });
  });

  it('feeds the Prometheus gauges once wired in at init', async () => {
    const service = new LiveGaugesService(dataSource, moduleRefWith());
    service.onModuleInit();

    const exposition = await register.metrics();

    expect(exposition).toContain('orders_in_status{status="COMPLETED"} 7');
    expect(exposition).toContain('outbox_pending_messages 3');
    await service.onModuleDestroy();
  });
});
