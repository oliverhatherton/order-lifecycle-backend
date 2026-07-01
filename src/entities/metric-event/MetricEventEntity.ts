import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A durable time-series sample backing `GET /metrics/history`. Prometheus
 * (`/metrics`) exposes the same counters/histograms but only the current
 * in-process values — a restart zeroes them and there's no history to chart.
 * Every collector call in `metrics.collectors.ts` also writes one row here
 * (fire-and-forget; a write failure never affects the request/consumer it's
 * timing), giving the UI a real history to poll instead of re-deriving it
 * from Prometheus scrapes.
 *
 * `value` means different things depending on `metric`: for a counter metric
 * (e.g. `orders_terminal`) each row is one occurrence, so `value` is always 1
 * and history queries sum it; for a duration metric (e.g.
 * `db_query_duration_ms`) `value` is the observed duration in milliseconds
 * and history queries average it.
 */
@Entity('metric_events')
@Index(['metric', 'recordedAt'])
export class MetricEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** One of the names in `PERSISTED_METRICS` (metrics.constants.ts). */
  @Column()
  metric: string;

  /** 1 for counter metrics; a duration in milliseconds for duration metrics. */
  @Column({ type: 'double precision' })
  value: number;

  /** The Prometheus labels the sample was recorded with, e.g. `{"consumer":"payment"}`. */
  @Column({ type: 'jsonb', nullable: true })
  labels: Record<string, string> | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  recordedAt: Date;
}
