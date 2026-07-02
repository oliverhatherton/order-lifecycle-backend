import { EntityManager } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { InventoryConsumer } from '@/modules/inventory/inventory.consumer';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { fakeCls } from '@/modules/messaging/testing/fake-cls';
import { OrdersService } from '@/modules/orders/services/orders.service';
import {
  InsufficientStockError,
  ProductsService,
} from '@/modules/products/products.service';
import { OrderStatus } from '@/entities/order/OrderStatus';
import {
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

describe('InventoryConsumer', () => {
  const inboxMock = { runOnce: jest.fn() };
  const ordersMock = { transitionOrder: jest.fn() };
  const productsMock = { reserveStock: jest.fn() };
  const outboxMock = { enqueue: jest.fn() };

  let consumer: InventoryConsumer;

  const event: OrderCreatedEvent = {
    orderId: 'order-1',
    userId: 'user-1',
    items: [{ productId: 'product-1', quantity: 2 }],
    occurredAt: '2026-01-01T00:00:00.000Z',
  };

  function messageWith(messageId?: string): ConsumeMessage {
    return { properties: { messageId } } as unknown as ConsumeMessage;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    productsMock.reserveStock.mockResolvedValue(undefined);
    consumer = new InventoryConsumer(
      inboxMock as unknown as InboxService,
      ordersMock as unknown as OrdersService,
      productsMock as unknown as ProductsService,
      outboxMock as unknown as OutboxService,
      fakeCls(),
    );
  });

  function runInboxWork(manager: EntityManager): void {
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
  }

  it('reserves stock, transitions to RESERVED, and stops there — no auto-publish', async () => {
    const manager = {} as EntityManager;
    runInboxWork(manager);

    await consumer.onOrderCreated(event, messageWith('msg-1'));

    expect(productsMock.reserveStock).toHaveBeenCalledWith(
      event.items,
      manager,
    );
    expect(ordersMock.transitionOrder).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.RESERVED,
      manager,
    );
    expect(outboxMock.enqueue).not.toHaveBeenCalled();
  });

  it('fails the order and enqueues OrderFailed when stock is insufficient', async () => {
    const manager = {} as EntityManager;
    runInboxWork(manager);
    productsMock.reserveStock.mockRejectedValue(
      new InsufficientStockError('product-1'),
    );

    await consumer.onOrderCreated(event, messageWith('msg-1'));

    expect(ordersMock.transitionOrder).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED,
      manager,
    );
    expect(outboxMock.enqueue).toHaveBeenCalledWith(
      manager,
      OrderRoutingKey.Failed,
      expect.objectContaining({
        orderId: 'order-1',
        reason: 'insufficient_stock',
      }),
    );
  });

  it('does not transition twice when the message was already processed', async () => {
    inboxMock.runOnce.mockResolvedValue(false);

    await consumer.onOrderCreated(event, messageWith('msg-1'));

    expect(ordersMock.transitionOrder).not.toHaveBeenCalled();
    expect(outboxMock.enqueue).not.toHaveBeenCalled();
  });

  it('dead-letters a message with no messageId without processing it', async () => {
    const result = await consumer.onOrderCreated(event, messageWith(undefined));

    expect(result).toBeInstanceOf(Nack);
    expect(inboxMock.runOnce).not.toHaveBeenCalled();
  });
});
