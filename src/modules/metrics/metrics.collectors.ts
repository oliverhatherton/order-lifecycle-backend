import { Counter, Histogram } from 'prom-client';

/**
 * Module-level Prometheus collectors recorded at call sites that have no Nest DI
 * to hand — the pure `processEventOnce` helper and the static retry error
 * handler. They register on prom-client's global registry, the same one the
 * `/metrics` controller serves, so they appear in exposition without extra
 * wiring. Defined once at import time (Node caches the module), so there is no
 * double-registration across the app or test suites.
 */

/** Shared latency histogram buckets (seconds), used by every duration metric. */
export const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];

/** A consumer either processed a message, skipped a redelivery, retried, or failed. */
export type ConsumerOutcome = 'processed' | 'skipped' | 'retried' | 'failed';

export const consumerMessagesTotal = new Counter({
  name: 'consumer_messages_total',
  help: 'Messages handled by each consumer, by outcome.',
  labelNames: ['consumer', 'outcome'],
});

export const consumerProcessingDuration = new Histogram({
  name: 'consumer_processing_duration_seconds',
  help: 'Time a consumer spends processing a single message.',
  labelNames: ['consumer'],
  buckets: DURATION_BUCKETS,
});

export const ordersTerminalTotal = new Counter({
  name: 'orders_terminal_total',
  help: 'Orders reaching a terminal state, by state.',
  labelNames: ['state'],
});

export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database operations, by operation.',
  labelNames: ['operation'],
  buckets: DURATION_BUCKETS,
});

export function recordConsumerOutcome(
  consumer: string,
  outcome: ConsumerOutcome,
): void {
  consumerMessagesTotal.inc({ consumer, outcome });
}

/** Starts a processing-duration timer for a consumer; call the result when done. */
export function startConsumerTimer(consumer: string): () => void {
  return consumerProcessingDuration.startTimer({ consumer });
}

export function recordTerminalState(state: 'completed' | 'failed'): void {
  ordersTerminalTotal.inc({ state });
}

/** Times a database operation, recording its duration regardless of outcome. */
export function timeDb<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const stop = dbQueryDuration.startTimer({ operation });
  return work().finally(stop);
}
