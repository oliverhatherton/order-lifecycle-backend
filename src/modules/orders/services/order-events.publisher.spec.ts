import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderEventsPublisher } from '@/modules/orders/services/order-events.publisher';
import { OrderRoutingKey } from '@/modules/messaging/events/order-events';
import { OrderEntityMother } from '@/entities/order/mother/OrderEntityMother';

describe('OrderEventsPublisher', () => {
  const amqpMock = { publish: jest.fn() };
  const configMock = {
    getOrThrow: jest.fn().mockReturnValue('order_lifecycle'),
  };

  let publisher: OrderEventsPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    publisher = new OrderEventsPublisher(
      amqpMock as unknown as AmqpConnection,
      configMock as unknown as ConfigService,
    );
  });

  it('publishes a typed OrderCreated event to the configured exchange', async () => {
    const order = OrderEntityMother.create({
      id: 'order-1',
      userId: 'user-1',
    });

    await publisher.publishOrderCreated(order);

    expect(amqpMock.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, payload, options] = amqpMock.publish.mock
      .calls[0] as [
      string,
      string,
      { orderId: string; userId: string; occurredAt: string },
      { messageId?: string; persistent?: boolean },
    ];

    expect(exchange).toBe('order_lifecycle');
    expect(routingKey).toBe(OrderRoutingKey.Created);
    expect(payload).toMatchObject({ orderId: 'order-1', userId: 'user-1' });
    expect(typeof payload.occurredAt).toBe('string');
    // A messageId is set so consumers can dedupe; published persistently.
    expect(options.messageId).toEqual(expect.any(String));
    expect(options.persistent).toBe(true);
  });
});
