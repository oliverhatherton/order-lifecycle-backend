import { Channel, ConsumeMessage } from 'amqplib';
import {
  createRetryErrorHandler,
  retryDelayMs,
  retryQueueName,
} from '@/modules/messaging/retry-error-handler';

describe('createRetryErrorHandler', () => {
  const channelMock = {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
  };
  const channel = channelMock as unknown as Channel;

  function message(attempts?: number): ConsumeMessage {
    return {
      content: Buffer.from('{}'),
      properties: {
        messageId: 'm1',
        headers: attempts === undefined ? {} : { 'x-attempts': attempts },
      },
      fields: {},
    } as unknown as ConsumeMessage;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RABBITMQ_RETRY_BASE_DELAY_MS;
  });

  it('parks the message in a delay queue with an incremented attempt count and acks', async () => {
    const handler = createRetryErrorHandler('q', 3);

    await handler(channel, message(0), new Error('boom'));

    expect(channelMock.sendToQueue).toHaveBeenCalledTimes(1);
    const [queue, content, options] = channelMock.sendToQueue.mock.calls[0] as [
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];
    expect(queue).toBe('q.retry.1000ms');
    expect(content).toBeInstanceOf(Buffer);
    expect(options.headers['x-attempts']).toBe(1);
    expect(channelMock.ack).toHaveBeenCalledTimes(1);
    expect(channelMock.nack).not.toHaveBeenCalled();
  });

  it('declares the delay queue to dead-letter back to the work queue after its TTL', async () => {
    const handler = createRetryErrorHandler('q', 3);

    await handler(channel, message(1), new Error('boom'));

    expect(channelMock.assertQueue).toHaveBeenCalledWith('q.retry.2000ms', {
      durable: true,
      arguments: {
        'x-message-ttl': 2000,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'q',
      },
    });
  });

  it('honours RABBITMQ_RETRY_BASE_DELAY_MS', async () => {
    process.env.RABBITMQ_RETRY_BASE_DELAY_MS = '50';
    const handler = createRetryErrorHandler('q', 3);

    await handler(channel, message(2), new Error('boom'));

    const [queue] = channelMock.sendToQueue.mock.calls[0] as [string];
    expect(queue).toBe('q.retry.200ms');
  });

  it('dead-letters (nack without requeue) once retries are exhausted', async () => {
    const handler = createRetryErrorHandler('q', 3);

    await handler(channel, message(3), new Error('boom'));

    // amqplib: nack(message, allUpTo, requeue) — requeue must be false to DLQ.
    const [, allUpTo, requeue] = channelMock.nack.mock.calls[0] as [
      ConsumeMessage,
      boolean,
      boolean,
    ];
    expect(allUpTo).toBe(false);
    expect(requeue).toBe(false);
    expect(channelMock.sendToQueue).not.toHaveBeenCalled();
  });
});

describe('retry backoff', () => {
  it('doubles the delay each attempt', () => {
    expect([1, 2, 3].map((n) => retryDelayMs(n, 1000))).toEqual([
      1000, 2000, 4000,
    ]);
  });

  it('names one wait queue per delay', () => {
    expect(retryQueueName('payment.inventory_reserved', 2000)).toBe(
      'payment.inventory_reserved.retry.2000ms',
    );
  });
});
