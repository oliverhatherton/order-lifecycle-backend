import { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Histogram } from 'prom-client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HttpMetricsInterceptor } from '@/modules/metrics/http-metrics.interceptor';

describe('HttpMetricsInterceptor', () => {
  const stop = jest.fn();
  const histogram = {
    startTimer: jest.fn(() => stop),
  } as unknown as Histogram<string>;

  const interceptor = new HttpMetricsInterceptor(histogram);

  function contextFor(
    request: Record<string, unknown>,
    statusCode = 200,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => jest.clearAllMocks());

  it('observes the route pattern, method and status on success', async () => {
    const context = contextFor(
      { method: 'GET', route: { path: '/orders/:id' } },
      200,
    );
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, next));

    expect(stop).toHaveBeenCalledWith({
      method: 'GET',
      route: '/orders/:id',
      status_code: 200,
    });
  });

  it('records the error status when the handler throws', async () => {
    const context = contextFor({ method: 'POST', route: { path: '/orders' } });
    const next: CallHandler = {
      handle: () => throwError(() => ({ status: 409 })),
    };

    await lastValueFrom(
      interceptor.intercept(context, next).pipe(catchError(() => of(null))),
    );

    expect(stop).toHaveBeenCalledWith({
      method: 'POST',
      route: '/orders',
      status_code: 409,
    });
  });

  it('labels an unmatched route as "unknown" and defaults a status-less error to 500', async () => {
    const context = contextFor({ method: 'GET' });
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await lastValueFrom(
      interceptor.intercept(context, next).pipe(catchError(() => of(null))),
    );

    expect(stop).toHaveBeenCalledWith({
      method: 'GET',
      route: 'unknown',
      status_code: 500,
    });
  });
});
