import { Logger } from '@nestjs/common';
import type { MessageErrorHandler } from '@golevelup/nestjs-rabbitmq';
import type { Channel, ConsumeMessage } from 'amqplib';
import { recordConsumerOutcome } from '@/modules/metrics/metrics.collectors';

const ATTEMPTS_HEADER = 'x-attempts';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const logger = new Logger('RetryErrorHandler');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The consumer label for a queue, e.g. `payment.inventory_reserved` → `payment`. */
function consumerOf(queue: string): string {
  return queue.split('.')[0];
}

/**
 * Base delay for the first retry. Read at failure time (not at decorator
 * evaluation) so e2e suites can shrink it via env without slowing every
 * resilience test down to real-world backoff.
 */
function baseDelayMs(): number {
  const fromEnv = Number(process.env.RABBITMQ_RETRY_BASE_DELAY_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0
    ? fromEnv
    : DEFAULT_BASE_DELAY_MS;
}

/** Exponential backoff: base, 2×base, 4×base, … for attempts 1, 2, 3, … */
export function retryDelayMs(attempt: number, base = baseDelayMs()): number {
  return base * 2 ** (attempt - 1);
}

/** The delay queue a retry waits in before dead-lettering back to `queue`. */
export function retryQueueName(queue: string, delayMs: number): string {
  return `${queue}.retry.${delayMs}ms`;
}

/**
 * Bounded-retry error handler with exponential backoff for golevelup
 * subscribers. When a handler throws, the message is parked in a per-delay
 * "wait" queue whose `x-message-ttl` is the backoff for that attempt and whose
 * dead-letter target is the original queue via the default exchange — so after
 * the delay the broker moves it back for another try. The messageId is
 * preserved so the inbox still dedupes. Once `maxRetries` is exhausted the
 * message is nacked without requeue, so the broker dead-letters it to the
 * DLX → DLQ.
 *
 * One queue per delay (rather than per-message `expiration` on a shared queue)
 * because RabbitMQ only expires messages at the head of a queue: a 4s message
 * in front of a 1s one would hold it back. Delays are deterministic (no
 * jitter) for the same reason — the set of wait queues stays bounded at
 * `maxRetries` per work queue.
 */
export function createRetryErrorHandler(
  queue: string,
  maxRetries = DEFAULT_MAX_RETRIES,
): MessageErrorHandler {
  return async (
    channel: Channel,
    msg: ConsumeMessage,
    error: unknown,
  ): Promise<void> => {
    const headers = msg.properties.headers ?? {};
    const attempts = Number(headers[ATTEMPTS_HEADER] ?? 0);

    if (attempts < maxRetries) {
      const attempt = attempts + 1;
      const delayMs = retryDelayMs(attempt);
      const waitQueue = retryQueueName(queue, delayMs);
      logger.warn(
        `Retrying ${queue} in ${delayMs}ms (attempt ${attempt}/${maxRetries}): ${errorMessage(error)}`,
      );
      // Idempotent declare — cheap after the first time, and keeps the wait
      // queues out of the static topology (they only exist once needed).
      await channel.assertQueue(waitQueue, {
        durable: true,
        arguments: {
          'x-message-ttl': delayMs,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': queue,
        },
      });
      channel.sendToQueue(waitQueue, msg.content, {
        ...msg.properties,
        headers: { ...headers, [ATTEMPTS_HEADER]: attempt },
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
