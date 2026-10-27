import { Counter, Gauge, Histogram } from 'prom-client';

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
 * Buckets (seconds) for order pipeline stages. Wider than DURATION_BUCKETS: a
 * stage spans broker hops, the outbox relay's 1s poll and, on failure, retry
 * backoff, so it lives in seconds rather than milliseconds.
 */
export const STAGE_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

export const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Orders created at checkout.',
});

/**
 * An order pipeline stage, timed from the moment the stage could start:
 *  - `reservation`: order created → RESERVED (or FAILED on short stock)
 *  - `payment`: "Pay" clicked → PAID (or FAILED on decline)
 *  - `completion`: PAID → COMPLETED
 *  - `fulfilment`: "Pay" clicked → COMPLETED — the async latency a user waits
 *    through after paying (excludes their own think-time before clicking Pay)
 */
export type OrderStage =
  | 'reservation'
  | 'payment'
  | 'completion'
  | 'fulfilment';

export const orderStageDuration = new Histogram({
  name: 'order_stage_duration_seconds',
  help: 'Time an order spends in each pipeline stage (see OrderStage).',
  labelNames: ['stage'],
  buckets: STAGE_BUCKETS,
});

export const orderFailuresTotal = new Counter({
  name: 'order_failures_total',
  help: 'Orders that ended FAILED, by reason (insufficient_stock, payment_declined, …).',
  labelNames: ['reason'],
});

/**
 * What PaymentGateway.authorize did for one call:
 *  - `authorized` / `declined`: this call charged the provider
 *  - `deduplicated`: a decision was already recorded — returned, not re-charged
 *  - `in_flight`: another delivery holds a live claim — backed off to retry
 *  - `takeover`: re-called the provider for a stale claim (same idempotency key)
 */
export type PaymentOutcome =
  | 'authorized'
  | 'declined'
  | 'deduplicated'
  | 'in_flight'
  | 'takeover';

export const paymentAuthorizationsTotal = new Counter({
  name: 'payment_authorizations_total',
  help: 'Payment authorization attempts, by outcome (see PaymentOutcome).',
  labelNames: ['outcome'],
});

/**
 * Point-in-time gauges read on every scrape — live state rather than event
 * counts. The values come from LiveGaugesService (DB + broker queries) via
 * the settable source below, the same pattern as the durable sink: this
 * module has no DI, and a test or a slimmed-down app without the source just
 * exports no samples for these.
 */
export interface LiveGaugeSnapshot {
  ordersByStatus: Record<string, number>;
  outboxPending: number;
  /** Age of the oldest unpublished outbox row; 0 when the outbox is empty. */
  outboxOldestAgeSeconds: number;
  /** Per queue; omitted for a queue the broker couldn't report on. */
  queues: Array<{ queue: string; messages: number; consumers: number }>;
}

export interface LiveGaugeSource {
  snapshot(): Promise<LiveGaugeSnapshot | undefined>;
}

let liveSource: LiveGaugeSource | undefined;

/** Wires the live gauge source in. Call once, at boot. */
export function setLiveGaugeSource(source: LiveGaugeSource | undefined): void {
  liveSource = source;
}

export const ordersInStatus = new Gauge({
  name: 'orders_in_status',
  help: 'Orders currently in each status — in-flight work (PENDING/RESERVED/PAID) and terminal totals.',
  labelNames: ['status'],
  async collect() {
    const snapshot = await liveSource?.snapshot();
    this.reset();
    for (const [status, count] of Object.entries(
      snapshot?.ordersByStatus ?? {},
    )) {
      this.set({ status }, count);
    }
  },
});

export const outboxPendingMessages = new Gauge({
  name: 'outbox_pending_messages',
  help: 'Outbox rows not yet published to the broker. Growing = relay or broker trouble.',
  async collect() {
    const snapshot = await liveSource?.snapshot();
    if (snapshot) this.set(snapshot.outboxPending);
  },
});

export const outboxOldestPendingAge = new Gauge({
  name: 'outbox_oldest_pending_age_seconds',
  help: 'Age of the oldest unpublished outbox row (0 when empty) — how stale the slowest event is.',
  async collect() {
    const snapshot = await liveSource?.snapshot();
    if (snapshot) this.set(snapshot.outboxOldestAgeSeconds);
  },
});

export const queueMessages = new Gauge({
  name: 'rabbitmq_queue_messages',
  help: 'Messages ready in each consumer queue and the DLQ, as reported by the broker.',
  labelNames: ['queue'],
  async collect() {
    const snapshot = await liveSource?.snapshot();
    this.reset();
    for (const q of snapshot?.queues ?? [])
      this.set({ queue: q.queue }, q.messages);
  },
});

export const queueConsumers = new Gauge({
  name: 'rabbitmq_queue_consumers',
  help: 'Consumers attached to each queue. 0 on a work queue = nothing is processing it.',
  labelNames: ['queue'],
  async collect() {
    const snapshot = await liveSource?.snapshot();
    this.reset();
    for (const q of snapshot?.queues ?? [])
      this.set({ queue: q.queue }, q.consumers);
  },
});

/** A cache read either found the key or didn't (a Redis error counts as a miss). */
export type CacheResult = 'hit' | 'miss';

export const cacheRequestsTotal = new Counter({
  name: 'cache_requests_total',
  help: 'Cache-aside reads, by key class (prefix before the first ":") and result. Hit rate = hit / (hit + miss).',
  labelNames: ['key_class', 'result'],
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

/**
 * Records one cache read. Prometheus-only — no durable history row, since a
 * hot read path would otherwise write a metric_events row per request.
 */
export function recordCacheRequest(
  keyClass: string,
  result: CacheResult,
): void {
  cacheRequestsTotal.inc({ key_class: keyClass, result });
}

export function recordOrderCreated(): void {
  ordersCreatedTotal.inc();
  sink?.record('orders_created', 1);
}

/** Records one stage duration; ignores a negative value (clock skew). */
export function recordOrderStage(stage: OrderStage, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  orderStageDuration.observe({ stage }, seconds);
  sink?.record('order_stage_duration_ms', seconds * 1000, { stage });
}

export function recordOrderFailure(reason: string): void {
  orderFailuresTotal.inc({ reason });
  sink?.record('order_failures', 1, { reason });
}

export function recordPaymentOutcome(outcome: PaymentOutcome): void {
  paymentAuthorizationsTotal.inc({ outcome });
  sink?.record('payment_authorizations', 1, { outcome });
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
