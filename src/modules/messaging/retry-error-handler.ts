import { Logger } from '@nestjs/common';
import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq';
import type { Channel, ConsumeMessage } from 'amqplib';
import { recordConsumerOutcome } from '@/modules/metrics/metrics.collectors';

const ATTEMPTS_HEADER = 'x-attempts';
const DEFAULT_MAX_RETRIES = 3;
const logger = new Logger('RetryErrorHandler');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The consumer label for a queue, e.g. `payment.inventory_reserved` → `payment`. */
function consumerOf(queue: string): string {
  return queue.split('.')[0];
}

/**
 * Bounded-retry error handler for golevelup subscribers. When a handler throws,
 * the message is re-published to the same queue (preserving its messageId so the
 * inbox still dedupes) up to `maxRetries` times; once exhausted it is nacked
 * without requeue, so the broker dead-letters it to the DLX → DLQ. Retries are
 * immediate (no backoff), which is enough to ride out a transient failure or a
 * consumer crash mid-flow while keeping a genuinely poison message bounded.
 */
export function createRetryErrorHandler(
  queue: string,
  maxRetries = DEFAULT_MAX_RETRIES,
): MessageErrorHandler {
  return (channel: Channel, msg: ConsumeMessage, error: unknown): void => {
    const headers = msg.properties.headers ?? {};
    const attempts = Number(headers[ATTEMPTS_HEADER] ?? 0);

    if (attempts < maxRetries) {
      logger.warn(
        `Retrying ${queue} (attempt ${attempts + 1}/${maxRetries}): ${errorMessage(error)}`,
      );
      channel.sendToQueue(queue, msg.content, {
        ...msg.properties,
        headers: { ...headers, [ATTEMPTS_HEADER]: attempts + 1 },
      });
      channel.ack(msg);
      recordConsumerOutcome(consumerOf(queue), 'retried');
      return;
    }

    logger.error(
      `Exhausted ${maxRetries} retries for ${queue}; dead-lettering: ${errorMessage(error)}`,
    );
    channel.nack(msg, false, false);
    recordConsumerOutcome(consumerOf(queue), 'failed');
  };
}
