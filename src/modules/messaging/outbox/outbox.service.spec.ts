import type { EntityManager } from 'typeorm';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { ORDER_EXCHANGE } from '@/modules/messaging/events/order-events';
import { CORRELATION_CLS_KEY } from '@/common/correlation/correlation.constants';
import { fakeCls } from '@/modules/messaging/testing/fake-cls';

describe('OutboxService', () => {
  const managerMock = { insert: jest.fn() };

  let cls: ReturnType<typeof fakeCls>;
  let service: OutboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    cls = fakeCls();
    service = new OutboxService(cls);
  });

  it('inserts a row on the exchange, carrying the payload and active correlation id', async () => {
    cls.set(CORRELATION_CLS_KEY, 'cid-123');

    await service.enqueue(
      managerMock as unknown as EntityManager,
      'order.created',
      { orderId: 'order-1' },
    );

    const [, insertedRow] = managerMock.insert.mock.calls[0] as [
      typeof OutboxMessageEntity,
      {
        id: string;
        exchange: string;
        routingKey: string;
        payload: object;
        correlationId: string;
      },
    ];
    expect(insertedRow).toMatchObject({
      exchange: ORDER_EXCHANGE,
      routingKey: 'order.created',
      payload: { orderId: 'order-1' },
      correlationId: 'cid-123',
    });
    expect(insertedRow.id.length).toBeGreaterThan(0);
  });

  it('generates a correlation id when none was set on the context', async () => {
    await service.enqueue(
      managerMock as unknown as EntityManager,
      'order.created',
      { orderId: 'order-1' },
    );

    const [, insertedRow] = managerMock.insert.mock.calls[0] as [
      unknown,
      { correlationId: string },
    ];
    expect(insertedRow.correlationId.length).toBeGreaterThan(0);
  });

  it('gives every enqueued row a fresh id', async () => {
    await service.enqueue(
      managerMock as unknown as EntityManager,
      'order.created',
      {},
    );
    await service.enqueue(
      managerMock as unknown as EntityManager,
      'order.created',
      {},
    );

    const [firstRow, secondRow] = managerMock.insert.mock.calls.map((call) => {
      const [, insertedRow] = call as [unknown, { id: string }];
      return insertedRow.id;
    });
    expect(firstRow).not.toBe(secondRow);
  });
});
