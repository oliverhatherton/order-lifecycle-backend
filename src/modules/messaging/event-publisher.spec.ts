import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { CORRELATION_ID_HEADER } from '@/common/correlation/correlation.constants';
import {
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

describe('EventPublisher', () => {
  const amqpMock = { publish: jest.fn() };
  const clsMock = {
    isActive: jest.fn().mockReturnValue(false),
    get: jest.fn(),
  };
  let publisher: EventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    clsMock.isActive.mockReturnValue(false);
    publisher = new EventPublisher(
      amqpMock as unknown as AmqpConnection,
      clsMock as unknown as ClsService,
    );
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
      { messageId?: string; persistent?: boolean; headers?: object },
    ];

    expect(exchange).toBe(ORDER_EXCHANGE);
    expect(routingKey).toBe(OrderRoutingKey.Created);
    expect(body).toBe(payload);
    expect(options.messageId).toEqual(expect.any(String));
    expect(options.persistent).toBe(true);
  });

  const headerOnFirstPublish = (): Record<string, string> =>
    (
      amqpMock.publish.mock.calls[0] as [
        string,
        string,
        object,
        { headers: Record<string, string> },
      ]
    )[3].headers;

  it('rides the active correlation id along as a message header', async () => {
    clsMock.isActive.mockReturnValue(true);
    clsMock.get.mockReturnValue('cid-123');

    await publisher.publish(OrderRoutingKey.Created, { a: 1 });

    expect(headerOnFirstPublish()[CORRELATION_ID_HEADER]).toBe('cid-123');
  });

  it('generates a correlation id header when none is active', async () => {
    await publisher.publish(OrderRoutingKey.Created, { a: 1 });

    expect(headerOnFirstPublish()[CORRELATION_ID_HEADER]).toEqual(
      expect.any(String),
    );
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
