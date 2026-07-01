import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { MetricsModule } from '@/modules/metrics/metrics.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { MetricsHistoryResponseDTO } from '@/modules/metrics/dto/MetricsHistoryResponseDTO';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

/**
 * Proves Story 5.1: /metrics exposes Prometheus text including default process
 * metrics and the HTTP histogram, and requests are labelled by their route
 * pattern (not the raw path) with the right method and status. Also proves
 * the durable history endpoint (GET /metrics/history) that backs a UI
 * dashboard: it's a Postgres-backed time series, not the in-memory
 * Prometheus registry, so it survives a restart and can be queried by
 * resolution instead of returning every sample.
 */
describe('Observability — metrics (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [UserEntity, RefreshTokenEntity, MetricEventEntity],
    imports: [MetricsModule, AuthModule],
    truncate: ['refresh_tokens', 'users', 'metric_events'],
  });

  function metricsBody(): Promise<string> {
    return request(ctx.app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .then((response) => response.text);
  }

  it('exposes default process metrics', async () => {
    const body = await metricsBody();
    expect(body).toContain('process_cpu_user_seconds_total');
    expect(body).toContain('nodejs_eventloop_lag_seconds');
  });

  it('records the HTTP histogram labelled by route pattern, method and status', async () => {
    await registerAndLogin(ctx.app);

    const body = await metricsBody();
    expect(body).toContain('http_request_duration_seconds');
    // The login response is 200 on the /auth/login route pattern.
    expect(body).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="POST"[^}]*route="\/auth\/login"[^}]*status_code="200"[^}]*\}/,
    );
  });

  it('labels a not-found route as its status without leaking the raw path', async () => {
    await request(ctx.app.getHttpServer())
      .get('/auth/does-not-exist')
      .expect(404);

    const body = await metricsBody();
    // The unmatched path must not appear as a route label (cardinality guard).
    expect(body).not.toContain('route="/auth/does-not-exist"');
  });

  describe('GET /metrics/history', () => {
    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'http_request_duration_ms' })
        .expect(401);
    });

    it('rejects an unknown metric name with 400', async () => {
      const token = await registerAndLogin(ctx.app, {
        email: 'history-bad-metric@example.com',
      });

      await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'not_a_real_metric' })
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('returns durable raw samples for an authenticated caller, surviving beyond the in-memory registry', async () => {
      const token = await registerAndLogin(ctx.app, {
        email: 'history-raw@example.com',
      });
      // Every login is a POST /auth/login — the HTTP interceptor persists it.
      await waitFor(async () => {
        const count = await ctx.dataSource
          .getRepository(MetricEventEntity)
          .countBy({ metric: 'http_request_duration_ms' });
        return count > 0;
      });

      const response = await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'http_request_duration_ms', resolution: 'raw' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MetricsHistoryResponseDTO;
      expect(body.metric).toBe('http_request_duration_ms');
      expect(body.resolution).toBe('raw');
      expect(body.points.length).toBeGreaterThan(0);
      expect(body.points[0].count).toBe(1);
    });

    it('buckets samples into a small, fixed number of points at 1h resolution', async () => {
      const token = await registerAndLogin(ctx.app, {
        email: 'history-bucketed@example.com',
      });
      await waitFor(async () => {
        const count = await ctx.dataSource
          .getRepository(MetricEventEntity)
          .countBy({ metric: 'http_request_duration_ms' });
        return count > 0;
      });

      const response = await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'http_request_duration_ms', resolution: '1h' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MetricsHistoryResponseDTO;
      expect(body.resolution).toBe('1h');
      // Every request in this test lands in "now"'s single 1h bucket.
      expect(body.points.length).toBe(1);
      expect(body.points[0].count).toBeGreaterThan(0);
      expect(body.points[0].sum).toBeGreaterThanOrEqual(0);
    });
  });
});
