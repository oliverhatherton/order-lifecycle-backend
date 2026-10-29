import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { setMetricsSink } from '@/modules/metrics/metrics.collectors';

/**
 * Wires a durable sink into `metrics.collectors.ts` for the lifetime of the
 * app, so every existing `recordX`/`timeDb` call also lands a row in
 * `metric_events` — no call sites elsewhere had to change. Writes are
 * fire-and-forget: a slow or unavailable database must never add latency to
 * (or fail) the request/consumer being timed, so `record` never awaits and
 * only logs on failure.
 *
 * Samples are buffered and written as one multi-row INSERT every
 * FLUSH_INTERVAL_MS (or sooner once FLUSH_AT_ROWS are waiting), stamped with
 * the time they were recorded. One insert per sample used to cost about two
 * pool connections and commits per HTTP request, which under load queued
 * the requests themselves behind their own metrics.
 */
@Injectable()
export class MetricsPersistenceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MetricsPersistenceService.name);
  private buffer: MetricRow[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;

  constructor(
    @InjectRepository(MetricEventEntity)
    private readonly repository: Repository<MetricEventEntity>,
  ) {}

  onModuleInit(): void {
    setMetricsSink(this);
  }

  async onModuleDestroy(): Promise<void> {
    setMetricsSink(undefined);
    clearTimeout(this.timer);
    await this.flushing;
    while (this.buffer.length > 0) await this.writeBatch();
  }

  record(metric: string, value: number, labels?: Record<string, string>): void {
    if (this.buffer.length >= MAX_BUFFERED_ROWS) {
      // The database has been unreachable for a while; drop rather than grow without bound.
      this.logger.warn(
        `Dropping metric ${metric}: ${MAX_BUFFERED_ROWS} samples already waiting`,
      );
      return;
    }
    this.buffer.push({
      metric,
      value,
      labels: labels ?? null,
      recordedAt: new Date(),
    });
    // While a batch is being written, it schedules the next one itself.
    if (this.flushing) return;
    if (this.buffer.length >= FLUSH_AT_ROWS) this.flushNow();
    else this.timer ??= setTimeout(() => this.flushNow(), FLUSH_INTERVAL_MS);
  }

  private flushNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing = this.writeBatch().finally(() => {
      this.flushing = undefined;
      if (this.buffer.length >= FLUSH_AT_ROWS) this.flushNow();
      else if (this.buffer.length > 0)
        this.timer = setTimeout(() => this.flushNow(), FLUSH_INTERVAL_MS);
    });
  }

  /** Inserts up to FLUSH_AT_ROWS buffered samples in one statement; never rejects. */
  private async writeBatch(): Promise<void> {
    const rows = this.buffer.splice(0, FLUSH_AT_ROWS);
    if (rows.length === 0) return;
    try {
      await this.repository.insert(rows);
    } catch (error) {
      this.logger.warn(
        `Failed to persist ${rows.length} metric samples: ${(error as Error).message}`,
      );
    }
  }
}

type MetricRow = Pick<
  MetricEventEntity,
  'metric' | 'value' | 'labels' | 'recordedAt'
>;

/** The longest a sample waits before it's written. */
const FLUSH_INTERVAL_MS = 250;
/** Write early once this many are waiting; also the most rows in one INSERT. */
const FLUSH_AT_ROWS = 500;
/** Beyond this, new samples are dropped (with a warning) until the database catches up. */
const MAX_BUFFERED_ROWS = 50_000;
