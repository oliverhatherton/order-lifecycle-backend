import { ConsumeMessage } from 'amqplib';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { EmailConsumer } from '@/modules/email/email.consumer';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import {
  OrderCompletedEvent,
  OrderFailedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

describe('EmailConsumer', () => {
  const inboxMock = { runOnce: jest.fn() };
  let consumer: EmailConsumer;

  function messageWith(routingKey: string, messageId?: string): ConsumeMessage {
    return {
      properties: { messageId },
      fields: { routingKey },
    } as unknown as ConsumeMessage;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    inboxMock.runOnce.mockResolvedValue(true);
    consumer = new EmailConsumer(inboxMock as unknown as InboxService);
  });

  it('reacts once to OrderCompleted via the email inbox', async () => {
    const event: OrderCompletedEvent = {
      orderId: 'order-1',
      userId: 'user-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };

    await consumer.onTerminalEvent(
      event,
      messageWith(OrderRoutingKey.Completed, 'msg-1'),
    );

    expect(inboxMock.runOnce).toHaveBeenCalledWith(
      'msg-1',
      'email',
      expect.any(Function),
    );
  });

  it('reacts to OrderFailed too', async () => {
    const event: OrderFailedEvent = {
      orderId: 'order-2',
      userId: 'user-2',
      reason: 'card_declined',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };

    await consumer.onTerminalEvent(
      event,
      messageWith(OrderRoutingKey.Failed, 'msg-2'),
    );

    expect(inboxMock.runOnce).toHaveBeenCalledWith(
      'msg-2',
      'email',
      expect.any(Function),
    );
  });

  it('dead-letters a message with no messageId', async () => {
    const event: OrderCompletedEvent = {
      orderId: 'order-1',
      userId: 'user-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };

    const result = await consumer.onTerminalEvent(
      event,
      messageWith(OrderRoutingKey.Completed, undefined),
    );

    expect(result).toBeInstanceOf(Nack);
    expect(inboxMock.runOnce).not.toHaveBeenCalled();
  });
});
