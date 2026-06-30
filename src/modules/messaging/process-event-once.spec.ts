import { Logger } from '@nestjs/common';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { processEventOnce } from '@/modules/messaging/process-event-once';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';

describe('processEventOnce', () => {
  const inboxMock = { runOnce: jest.fn() };
  const logger = { log: jest.fn(), error: jest.fn() } as unknown as Logger;
  const inbox = inboxMock as unknown as InboxService;

  function message(messageId?: string): ConsumeMessage {
    return { properties: { messageId } } as unknown as ConsumeMessage;
  }

  beforeEach(() => jest.clearAllMocks());

  it('returns a Nack and never touches the inbox when messageId is missing', async () => {
    const work = jest.fn();

    const result = await processEventOnce(
      message(undefined),
      'c',
      inbox,
      logger,
      work,
    );

    expect(result).toBeInstanceOf(Nack);
    expect(inboxMock.runOnce).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('returns "processed" and delegates work to the inbox on first delivery', async () => {
    const work = jest.fn();
    inboxMock.runOnce.mockResolvedValue(true);

    const result = await processEventOnce(
      message('m1'),
      'c',
      inbox,
      logger,
      work,
    );

    expect(result).toBe('processed');
    expect(inboxMock.runOnce).toHaveBeenCalledWith('m1', 'c', work);
  });

  it('returns "skipped" when the inbox reports the message already handled', async () => {
    inboxMock.runOnce.mockResolvedValue(false);

    const result = await processEventOnce(
      message('m1'),
      'c',
      inbox,
      logger,
      jest.fn(),
    );

    expect(result).toBe('skipped');
  });
});
