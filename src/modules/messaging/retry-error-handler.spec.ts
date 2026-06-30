import { Channel, ConsumeMessage } from 'amqplib';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';

describe('createRetryErrorHandler', () => {
  const channelMock = {
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

  beforeEach(() => jest.clearAllMocks());

  it('republishes to the queue with an incremented attempt count and acks', () => {
    const handler = createRetryErrorHandler('q', 3);

    void handler(channel, message(0), new Error('boom'));

    expect(channelMock.sendToQueue).toHaveBeenCalledTimes(1);
    const [queue, content, options] = channelMock.sendToQueue.mock.calls[0] as [
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];
    expect(queue).toBe('q');
    expect(content).toBeInstanceOf(Buffer);
    expect(options.headers['x-attempts']).toBe(1);
    expect(channelMock.ack).toHaveBeenCalledTimes(1);
    expect(channelMock.nack).not.toHaveBeenCalled();
  });

  it('dead-letters (nack without requeue) once retries are exhausted', () => {
    const handler = createRetryErrorHandler('q', 3);

    void handler(channel, message(3), new Error('boom'));

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
