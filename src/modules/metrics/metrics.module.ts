import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  PrometheusModule,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { HttpMetricsInterceptor } from '@/modules/metrics/http-metrics.interceptor';
import { HTTP_REQUEST_DURATION_SECONDS } from '@/modules/metrics/metrics.constants';

/**
 * Owns Prometheus exposition (`/metrics`, with default process metrics) and the
 * global HTTP-latency interceptor. Registered once in AppModule; the interceptor
 * is wired via APP_INTERCEPTOR so it can inject the histogram by DI.
 */
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeHistogramProvider({
      name: HTTP_REQUEST_DURATION_SECONDS,
      help: 'HTTP request duration in seconds, by method, route and status.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule {}
