import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import {
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

describe('EventPublisher', () => {
  const amqpMock = { publish: jest.fn() };
  let publisher: EventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new EventPublisher(amqpMock as unknown as AmqpConnection);
  });

  it('publishes to the order exchange with a messageId and persistence', async () => {
    const payload = { orderId: 'order-1', userId: 'user-1' };

    await publisher.publish(OrderRoutingKey.Created, payload);

    expect(amqpMock.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, body, options] = amqpMock.publish.mock
      .calls[0] as [
      string,
      string,
      object,
      { messageId?: string; persistent?: boolean },
    ];

    expect(exchange).toBe(ORDER_EXCHANGE);
    expect(routingKey).toBe(OrderRoutingKey.Created);
    expect(body).toBe(payload);
    expect(options.messageId).toEqual(expect.any(String));
    expect(options.persistent).toBe(true);
  });

  it('uses a distinct messageId per publish', async () => {
    await publisher.publish(OrderRoutingKey.Created, { a: 1 });
    await publisher.publish(OrderRoutingKey.Created, { a: 2 });

    const optionsAt = (index: number): { messageId: string } =>
      (
        amqpMock.publish.mock.calls[index] as [
          string,
          string,
          object,
          { messageId: string },
        ]
      )[3];
    expect(optionsAt(0).messageId).not.toBe(optionsAt(1).messageId);
  });
});
