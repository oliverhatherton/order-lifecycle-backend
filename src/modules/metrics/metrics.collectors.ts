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

export const outboxRelayedTotal = new Counter({
  name: 'outbox_relayed_messages_total',
  help: 'Messages successfully relayed from the outbox table to the broker.',
});

/**
 * Sink for durable metric history, set once at boot by
 * MetricsPersistenceService.onModuleInit. Optional by design: this module has
 * no Nest DI, so persistence is wired in via this settable reference rather
 * than a constructor — and every collector below degrades to
 * Prometheus-only (in-memory) if it's never set, e.g. in unit tests.
 */
export interface MetricsSink {
  record(metric: string, value: number, labels?: Record<string, string>): void;
}

let sink: MetricsSink | undefined;

/** Wires a durable sink into the collectors below. Call once, at boot. */
export function setMetricsSink(newSink: MetricsSink | undefined): void {
  sink = newSink;
}

/**
 * Records one sample directly against the durable sink, for call sites (like
 * HttpMetricsInterceptor) that already own a prom-client collector and just
 * need the matching history row.
 */
export function recordMetricSample(
  metric: string,
  value: number,
  labels?: Record<string, string>,
): void {
  sink?.record(metric, value, labels);
}

export function recordConsumerOutcome(
  consumer: string,
  outcome: ConsumerOutcome,
): void {
  consumerMessagesTotal.inc({ consumer, outcome });
  sink?.record('consumer_messages', 1, { consumer, outcome });
}

/** Starts a processing-duration timer for a consumer; call the result when done. */
export function startConsumerTimer(consumer: string): () => void {
  const stop = consumerProcessingDuration.startTimer({ consumer });
  return () => {
    const seconds = stop();
    sink?.record('consumer_processing_duration_ms', seconds * 1000, {
      consumer,
    });
  };
}

export function recordTerminalState(
  state: 'completed' | 'failed' | 'cancelled',
): void {
  ordersTerminalTotal.inc({ state });
  sink?.record('orders_terminal', 1, { state });
}

/** Records a batch of outbox rows successfully published to the broker. */
export function recordOutboxRelayed(count: number): void {
  if (count === 0) return;
  outboxRelayedTotal.inc(count);
  sink?.record('outbox_relayed', count);
}

/** Times a database operation, recording its duration regardless of outcome. */
export function timeDb<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const stop = dbQueryDuration.startTimer({ operation });
  return work().finally(() => {
    const seconds = stop();
    sink?.record('db_query_duration_ms', seconds * 1000, { operation });
  });
}
