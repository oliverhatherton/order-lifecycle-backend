import type { DataSource, EntityManager } from 'typeorm';
import { OutboxRelayService } from '@/modules/messaging/outbox/outbox-relay.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import * as collectors from '@/modules/metrics/metrics.collectors';

jest.mock('@/modules/metrics/metrics.collectors', () => ({
  recordOutboxRelayed: jest.fn(),
}));

describe('OutboxRelayService', () => {
  const queryBuilderMock = {
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    setLock: jest.fn(),
    setOnLocked: jest.fn(),
    getMany: jest.fn(),
  };
  const managerMock = {
    createQueryBuilder: jest.fn(() => queryBuilderMock),
    update: jest.fn(),
  };
  const dataSourceMock = {
    transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
      work(managerMock as unknown as EntityManager),
    ),
  };
  const publisherMock = { publish: jest.fn() };

  let service: OutboxRelayService;

  function row(
    overrides: Partial<OutboxMessageEntity> = {},
  ): OutboxMessageEntity {
    return {
      id: 'msg-1',
      exchange: 'order_lifecycle',
      routingKey: 'order.created',
      payload: { orderId: 'order-1' },
      correlationId: 'cid-1',
      createdAt: new Date(),
      publishedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilderMock.where.mockReturnValue(queryBuilderMock);
    queryBuilderMock.orderBy.mockReturnValue(queryBuilderMock);
    queryBuilderMock.limit.mockReturnValue(queryBuilderMock);
    queryBuilderMock.setLock.mockReturnValue(queryBuilderMock);
    queryBuilderMock.setOnLocked.mockReturnValue(queryBuilderMock);
    publisherMock.publish.mockResolvedValue(undefined);
    service = new OutboxRelayService(
      dataSourceMock as unknown as DataSource,
      publisherMock as unknown as EventPublisher,
    );
  });

  it('does nothing when there are no unpublished rows', async () => {
    queryBuilderMock.getMany.mockResolvedValue([]);

    await service.relay();

    expect(publisherMock.publish).not.toHaveBeenCalled();
    expect(managerMock.update).not.toHaveBeenCalled();
    expect(collectors.recordOutboxRelayed).not.toHaveBeenCalled();
  });

  it('publishes each unpublished row and marks it published', async () => {
    const first = row({ id: 'msg-1' });
    const second = row({ id: 'msg-2', routingKey: 'order.failed' });
    queryBuilderMock.getMany.mockResolvedValue([first, second]);

    await service.relay();

    expect(publisherMock.publish).toHaveBeenCalledWith(
      first.exchange,
      first.routingKey,
      first.payload,
      first.id,
      first.correlationId,
    );
    expect(publisherMock.publish).toHaveBeenCalledWith(
      second.exchange,
      second.routingKey,
      second.payload,
      second.id,
      second.correlationId,
    );
    const [, ids, patch] = managerMock.update.mock.calls[0] as [
      unknown,
      string[],
      { publishedAt: Date },
    ];
    expect(ids).toEqual(['msg-1', 'msg-2']);
    expect(patch.publishedAt).toBeInstanceOf(Date);
    expect(collectors.recordOutboxRelayed).toHaveBeenCalledWith(2);
  });

  it('leaves a row unmarked (for retry) when its publish fails, without blocking the rest', async () => {
    const bad = row({ id: 'msg-bad' });
    const good = row({ id: 'msg-good' });
    queryBuilderMock.getMany.mockResolvedValue([bad, good]);
    publisherMock.publish.mockImplementation(
      (_ex, _rk, _payload, id: string) =>
        id === 'msg-bad'
          ? Promise.reject(new Error('broker down'))
          : Promise.resolve(undefined),
    );

    await service.relay();

    const [, ids, patch] = managerMock.update.mock.calls[0] as [
      unknown,
      string[],
      { publishedAt: Date },
    ];
    expect(ids).toEqual(['msg-good']);
    expect(patch.publishedAt).toBeInstanceOf(Date);
    expect(collectors.recordOutboxRelayed).toHaveBeenCalledWith(1);
  });

  it('skips a tick that starts while the previous one is still draining', async () => {
    let releaseFirst: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    queryBuilderMock.getMany.mockImplementation(async () => {
      await blocked;
      return [];
    });

    const firstTick = service.relay();
    const secondTick = service.relay();
    releaseFirst();
    await Promise.all([firstTick, secondTick]);

    // Only the first tick's transaction ran; the overlapping second was a no-op.
    expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
  });
});
