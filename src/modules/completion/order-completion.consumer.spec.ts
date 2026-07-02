import { EntityManager } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { OrderCompletionConsumer } from '@/modules/completion/order-completion.consumer';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { fakeCls } from '@/modules/messaging/testing/fake-cls';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderStatus } from '@/entities/order/OrderStatus';
import {
  OrderRoutingKey,
  PaymentProcessedEvent,
} from '@/modules/messaging/events/order-events';

describe('OrderCompletionConsumer', () => {
  const inboxMock = { runOnce: jest.fn() };
  const ordersMock = { transitionOrder: jest.fn() };
  const outboxMock = { enqueue: jest.fn() };

  let consumer: OrderCompletionConsumer;

  const event: PaymentProcessedEvent = {
    orderId: 'order-1',
    userId: 'user-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
  };

  function messageWith(messageId?: string): ConsumeMessage {
    return { properties: { messageId } } as unknown as ConsumeMessage;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new OrderCompletionConsumer(
      inboxMock as unknown as InboxService,
      ordersMock as unknown as OrdersService,
      outboxMock as unknown as OutboxService,
      fakeCls(),
    );
  });

  it('transitions PAID → COMPLETED and enqueues OrderCompleted', async () => {
    const manager = {} as EntityManager;
    inboxMock.runOnce.mockImplementation(
      async (
        _id: string,
        _consumer: string,
        work: (m: EntityManager) => Promise<void>,
      ) => {
        await work(manager);
        return true;
      },
    );

    await consumer.onPaymentProcessed(event, messageWith('msg-1'));

    expect(ordersMock.transitionOrder).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.COMPLETED,
      manager,
    );
    expect(outboxMock.enqueue).toHaveBeenCalledWith(
      manager,
      OrderRoutingKey.Completed,
      expect.objectContaining({ orderId: 'order-1', userId: 'user-1' }),
    );
  });

  it('does not re-enqueue when already processed', async () => {
    inboxMock.runOnce.mockResolvedValue(false);

    await consumer.onPaymentProcessed(event, messageWith('msg-1'));

    expect(outboxMock.enqueue).not.toHaveBeenCalled();
  });

  it('dead-letters a message with no messageId', async () => {
    const result = await consumer.onPaymentProcessed(
      event,
      messageWith(undefined),
    );

    expect(result).toBeInstanceOf(Nack);
    expect(inboxMock.runOnce).not.toHaveBeenCalled();
  });
});
