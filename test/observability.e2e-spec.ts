import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { MetricsModule } from '@/modules/metrics/metrics.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { registerAndLogin, setupE2eTest } from '@test/support/e2e';

/**
 * Proves Story 5.1: /metrics exposes Prometheus text including default process
 * metrics and the HTTP histogram, and requests are labelled by their route
 * pattern (not the raw path) with the right method and status.
 */
describe('Observability — metrics (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [UserEntity, RefreshTokenEntity],
    imports: [MetricsModule, AuthModule],
    truncate: ['refresh_tokens', 'users'],
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
});
