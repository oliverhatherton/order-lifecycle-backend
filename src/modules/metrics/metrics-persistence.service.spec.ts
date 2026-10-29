import type { Repository } from 'typeorm';
import type { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { MetricsPersistenceService } from '@/modules/metrics/metrics-persistence.service';

describe('MetricsPersistenceService', () => {
  let insert: jest.Mock;
  let service: MetricsPersistenceService;

  beforeEach(() => {
    jest.useFakeTimers();
    insert = jest.fn().mockResolvedValue(undefined);
    service = new MetricsPersistenceService({
      insert,
    } as unknown as Repository<MetricEventEntity>);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Rows passed to each insert call. */
  function batches(): Array<Array<{ metric: string; recordedAt: Date }>> {
    return insert.mock.calls.map(
      ([rows]: [Array<{ metric: string; recordedAt: Date }>]) => rows,
    );
  }

  it('writes samples recorded close together as one insert, stamped when recorded', async () => {
    const before = Date.now();
    service.record('http_request_duration_ms', 12, { route: '/orders' });
    service.record('db_query_duration_ms', 3, { operation: 'orders.list' });
    expect(insert).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(250);

    expect(batches()).toHaveLength(1);
    expect(batches()[0]).toEqual([
      expect.objectContaining({
        metric: 'http_request_duration_ms',
        value: 12,
        labels: { route: '/orders' },
      }),
      expect.objectContaining({
        metric: 'db_query_duration_ms',
        value: 3,
        labels: { operation: 'orders.list' },
      }),
    ]);
    expect(batches()[0][0].recordedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('stores a missing label set as null', async () => {
    service.record('cpu_percent', 40);
    await jest.advanceTimersByTimeAsync(250);
    expect(batches()[0][0]).toEqual(expect.objectContaining({ labels: null }));
  });

  it('writes early once a full batch is waiting, and never more than one batch per insert', async () => {
    for (let i = 0; i < 1200; i += 1) service.record('outbox_relayed', 1);
    await jest.advanceTimersByTimeAsync(0);
    expect(batches()[0]).toHaveLength(500);

    await jest.advanceTimersByTimeAsync(250);
    expect(batches().map((rows) => rows.length)).toEqual([500, 500, 200]);
  });

  it('logs and carries on when an insert fails', async () => {
    insert.mockRejectedValueOnce(new Error('connection refused'));
    const warn = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);

    service.record('orders_created', 1);
    await jest.advanceTimersByTimeAsync(250);
    service.record('orders_created', 1);
    await jest.advanceTimersByTimeAsync(250);

    expect(warn).toHaveBeenCalledWith(
      'Failed to persist 1 metric samples: connection refused',
    );
    expect(batches()).toHaveLength(2);
  });

  it('writes whatever is still buffered on shutdown', async () => {
    service.record('orders_terminal', 1, { state: 'completed' });
    await service.onModuleDestroy();
    expect(batches()).toHaveLength(1);
  });
});
