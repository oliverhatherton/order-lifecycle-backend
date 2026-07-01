import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import type { Histogram } from 'prom-client';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HTTP_REQUEST_DURATION_SECONDS } from '@/modules/metrics/metrics.constants';
import { recordMetricSample } from '@/modules/metrics/metrics.collectors';

/**
 * Records request latency into the `http_request_duration_seconds` histogram.
 * The `route` label is the matched **route pattern** (e.g. `/orders/:id`), never
 * the raw URL, so path parameters don't explode label cardinality; the
 * histogram's `_count` doubles as the request counter and `status_code` yields
 * the error rate.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly histogram: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const method = request.method;
    const stop = this.histogram.startTimer();

    const observe = (statusCode: number): void => {
      const route = routePattern(request);
      const seconds = stop({ method, route, status_code: statusCode });
      recordMetricSample('http_request_duration_ms', seconds * 1000, {
        method,
        route,
        status_code: String(statusCode),
      });
    };

    return next.handle().pipe(
      tap({
        next: () => observe(http.getResponse<Response>().statusCode),
        error: (error: { status?: number }) => observe(error.status ?? 500),
      }),
    );
  }
}

/** The Express route pattern for this request, or `unknown` if unmatched. */
function routePattern(request: Request): string {
  const route = request.route as { path?: string } | undefined;
  return route?.path ?? 'unknown';
}
