import { Logger } from '@nestjs/common';
import { Nack } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import type { EntityManager } from 'typeorm';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import {
  recordConsumerOutcome,
  startConsumerTimer,
} from '@/modules/metrics/metrics.collectors';

/** Result of a once-only event handling attempt. */
export type EventOutcome = 'processed' | 'skipped';

/**
 * Shared consumer entry point: a message must carry a `messageId` (else it is
 * dead-lettered via Nack), and `work` runs at most once per (messageId,
 * consumer) through the inbox. Returns `'processed'` when the work ran,
 * `'skipped'` on a redelivery, or a `Nack` for a message with no id — letting
 * each consumer focus on its own side effect and follow-up event.
 */
export async function processEventOnce(
  amqpMsg: ConsumeMessage,
  consumer: string,
  inbox: InboxService,
  logger: Logger,
  work: (manager: EntityManager) => Promise<void>,
): Promise<EventOutcome | Nack> {
  const messageId = amqpMsg.properties.messageId as string | undefined;
  if (!messageId) {
    logger.error(`Message on ${consumer} has no messageId; dead-lettering`);
    recordConsumerOutcome(consumer, 'failed');
    return new Nack(false);
  }

  const stopTimer = startConsumerTimer(consumer);
  let ran: boolean;
  try {
    ran = await inbox.runOnce(messageId, consumer, work);
  } finally {
    stopTimer();
  }

  if (!ran) {
    logger.log(`Skipped already-processed message ${messageId} on ${consumer}`);
  }
  recordConsumerOutcome(consumer, ran ? 'processed' : 'skipped');
  return ran ? 'processed' : 'skipped';
}
