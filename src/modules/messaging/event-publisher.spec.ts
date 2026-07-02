import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { CORRELATION_ID_HEADER } from '@/common/correlation/correlation.constants';
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

  it('publishes to the given exchange with the given messageId, persistently', async () => {
    const payload = { orderId: 'order-1', userId: 'user-1' };

    await publisher.publish(
      ORDER_EXCHANGE,
      OrderRoutingKey.Created,
      payload,
      'msg-1',
      'cid-1',
    );

    expect(amqpMock.publish).toHaveBeenCalledWith(
      ORDER_EXCHANGE,
      OrderRoutingKey.Created,
      payload,
      {
        messageId: 'msg-1',
        persistent: true,
        headers: { [CORRELATION_ID_HEADER]: 'cid-1' },
      },
    );
  });

  it('carries the given correlation id as a message header', async () => {
    await publisher.publish(
      ORDER_EXCHANGE,
      OrderRoutingKey.Created,
      { a: 1 },
      'msg-2',
      'cid-2',
    );

    const [, , , options] = amqpMock.publish.mock.calls[0] as [
      string,
      string,
      object,
      { headers: Record<string, string> },
    ];
    expect(options.headers[CORRELATION_ID_HEADER]).toBe('cid-2');
  });
});
