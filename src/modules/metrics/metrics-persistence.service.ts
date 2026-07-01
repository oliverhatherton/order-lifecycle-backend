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
 */
@Injectable()
export class MetricsPersistenceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MetricsPersistenceService.name);

  constructor(
    @InjectRepository(MetricEventEntity)
    private readonly repository: Repository<MetricEventEntity>,
  ) {}

  onModuleInit(): void {
    setMetricsSink(this);
  }

  onModuleDestroy(): void {
    setMetricsSink(undefined);
  }

  record(metric: string, value: number, labels?: Record<string, string>): void {
    this.repository
      .insert({ metric, value, labels: labels ?? null })
      .catch((error: Error) => {
        this.logger.warn(
          `Failed to persist metric ${metric}: ${error.message}`,
        );
      });
  }
}
