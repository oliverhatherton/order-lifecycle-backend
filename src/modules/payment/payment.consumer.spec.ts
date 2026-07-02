import { EntityManager } from 'typeorm';
import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { PaymentConsumer } from '@/modules/payment/payment.consumer';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { fakeCls } from '@/modules/messaging/testing/fake-cls';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderStatus } from '@/entities/order/OrderStatus';
import {
  InventoryReservedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

describe('PaymentConsumer', () => {
  const inboxMock = { runOnce: jest.fn() };
  const ordersMock = { transitionOrder: jest.fn() };
  const outboxMock = { enqueue: jest.fn() };
  const gatewayMock = { authorize: jest.fn() };

  let consumer: PaymentConsumer;

  const event: InventoryReservedEvent = {
    orderId: 'order-1',
    userId: 'user-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
  };

  function messageWith(messageId?: string): ConsumeMessage {
    return { properties: { messageId } } as unknown as ConsumeMessage;
  }

  /** Drives the inbox to run the work (so transition wiring is exercised). */
  function runWork(): EntityManager {
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
    return manager;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new PaymentConsumer(
      inboxMock as unknown as InboxService,
      ordersMock as unknown as OrdersService,
      outboxMock as unknown as OutboxService,
      gatewayMock as unknown as PaymentGateway,
      fakeCls(),
    );
  });

  it('on authorisation: transitions to PAID and enqueues PaymentProcessed', async () => {
    gatewayMock.authorize.mockResolvedValue({ authorized: true });
    const manager = runWork();

    await consumer.onInventoryReserved(event, messageWith('msg-1'));

    expect(ordersMock.transitionOrder).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.PAID,
      manager,
    );
    expect(outboxMock.enqueue).toHaveBeenCalledWith(
      manager,
      OrderRoutingKey.PaymentProcessed,
      expect.objectContaining({ orderId: 'order-1', userId: 'user-1' }),
    );
  });

  it('on decline: transitions to FAILED and enqueues OrderFailed with a reason', async () => {
    gatewayMock.authorize.mockResolvedValue({
      authorized: false,
      declineReason: 'insufficient_funds',
    });
    const manager = runWork();

    await consumer.onInventoryReserved(event, messageWith('msg-1'));

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
        reason: 'insufficient_funds',
      }),
    );
  });

  it('does not re-enqueue when the message was already processed', async () => {
    gatewayMock.authorize.mockResolvedValue({ authorized: true });
    inboxMock.runOnce.mockResolvedValue(false);

    await consumer.onInventoryReserved(event, messageWith('msg-1'));

    expect(outboxMock.enqueue).not.toHaveBeenCalled();
  });

  it('dead-letters a message with no messageId without charging', async () => {
    const result = await consumer.onInventoryReserved(
      event,
      messageWith(undefined),
    );

    expect(result).toBeInstanceOf(Nack);
    expect(gatewayMock.authorize).not.toHaveBeenCalled();
    expect(inboxMock.runOnce).not.toHaveBeenCalled();
  });
});
