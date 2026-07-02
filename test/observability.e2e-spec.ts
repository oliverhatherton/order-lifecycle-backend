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

    it('omitting `from` reaches all the way back, not just a recent window', async () => {
      const token = await registerAndLogin(ctx.app, {
        email: 'history-since-beginning@example.com',
      });
      // A sample from over a year ago — well outside any of the old
      // per-resolution lookback windows this endpoint used to default to.
      const ancient = new Date('2020-01-01T00:00:00.000Z');
      await ctx.dataSource.getRepository(MetricEventEntity).insert({
        metric: 'orders_terminal',
        value: 1,
        labels: { state: 'completed' },
        recordedAt: ancient,
      });

      const response = await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'orders_terminal', resolution: 'raw' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MetricsHistoryResponseDTO;
      expect(
        body.points.some((p) => p.bucketStart === ancient.toISOString()),
      ).toBe(true);
    });

    it('caps bucketed history to the most recent buckets, not the oldest', async () => {
      const token = await registerAndLogin(ctx.app, {
        email: 'history-recency-cap@example.com',
      });
      const repository = ctx.dataSource.getRepository(MetricEventEntity);

      // 550 hourly buckets — comfortably over the 500-point cap — spread
      // from 550 hours ago up to now, oldest first.
      const bucketCount = 550;
      const now = Date.now();
      const rows = Array.from({ length: bucketCount }, (_, i) => ({
        metric: 'db_query_duration_ms',
        value: 10,
        labels: null,
        recordedAt: new Date(now - (bucketCount - i) * 60 * 60 * 1000),
      }));
      await repository.insert(rows);

      const response = await request(ctx.app.getHttpServer())
        .get('/metrics/history')
        .query({ metric: 'db_query_duration_ms', resolution: '1h' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MetricsHistoryResponseDTO;
      expect(body.points.length).toBe(500);
      // The oldest bucket kept should be recent (within the last ~500
      // hours), not from 550 hours ago — proving the cap kept the tail
      // (most recent), not the head (oldest), of the history.
      const oldestKept = new Date(body.points[0].bucketStart).getTime();
      expect(oldestKept).toBeGreaterThan(now - 501 * 60 * 60 * 1000);
      // The response is still chronological (ascending).
      const timestamps = body.points.map((p) =>
        new Date(p.bucketStart).getTime(),
      );
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });
  });
});
