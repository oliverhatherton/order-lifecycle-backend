import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PrometheusModule,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { AuthModule } from '@/modules/auth/auth.module';
import { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { HttpMetricsInterceptor } from '@/modules/metrics/http-metrics.interceptor';
import { MetricsHistoryController } from '@/modules/metrics/metrics-history.controller';
import { MetricsHistoryService } from '@/modules/metrics/metrics-history.service';
import { MetricsPersistenceService } from '@/modules/metrics/metrics-persistence.service';
import { HTTP_REQUEST_DURATION_SECONDS } from '@/modules/metrics/metrics.constants';
import { DURATION_BUCKETS } from '@/modules/metrics/metrics.collectors';

/**
 * Owns Prometheus exposition (`/metrics`, with default process metrics), the
 * global HTTP-latency interceptor, and the durable metric history behind
 * `GET /metrics/history` (MetricsPersistenceService mirrors every collector
 * call into `metric_events`; MetricsHistoryController/Service serve it back
 * bucketed by resolution). Registered once in AppModule; the interceptor is
 * wired via APP_INTERCEPTOR so it can inject the histogram by DI.
 */
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
    TypeOrmModule.forFeature([MetricEventEntity]),
    AuthModule,
  ],
  controllers: [MetricsHistoryController],
  providers: [
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION_SECONDS,
      help: 'HTTP request duration in seconds, by method, route and status.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: DURATION_BUCKETS,
    }),
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    MetricsPersistenceService,
    MetricsHistoryService,
  ],
})
export class MetricsModule {}
