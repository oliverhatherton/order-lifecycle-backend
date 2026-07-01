/** Metric names, shared by the providers and the collectors that record them. */
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';

/**
 * Metric names persisted to `metric_events` and queryable via
 * `GET /metrics/history?metric=`. A subset of the Prometheus collectors —
 * the ones meaningful as a time series in a UI dashboard.
 */
export const PERSISTED_METRICS = [
  'consumer_messages',
  'consumer_processing_duration_ms',
  'orders_terminal',
  'db_query_duration_ms',
  'http_request_duration_ms',
  'stock_replenished',
] as const;

export type PersistedMetricName = (typeof PERSISTED_METRICS)[number];

/**
 * How `GET /metrics/history` buckets samples. `raw` returns individual
 * samples (capped and windowed — see MetricsHistoryService); every other
 * value groups samples into fixed-width buckets of that size, so the
 * response stays a handful of points instead of every sample ever recorded.
 */
export enum MetricResolution {
  RAW = 'raw',
  ONE_HOUR = '1h',
  SIX_HOURS = '6h',
  TWELVE_HOURS = '12h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w',
  ONE_MONTH = '1mo',
}
