import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { CacheService } from '@/modules/cache/cache.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import { registerAndLogin, setupE2eTest } from '@test/support/e2e';

/**
 * Proves the Epic 4 caching behaviour against a real Redis container: reads
 * (single + list) are served from cache, writes invalidate them, the by-id
 * cache never leaks an order across users (4.1/4.2), and the hit-rate counters
 * plus a cold-vs-warm benchmark make the speed-up observable (4.3).
 */
describe('Order caching (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      ProcessedMessageEntity,
    ],
    imports: [AuthModule, OrdersModule],
    truncate: ['processed_messages', 'orders', 'refresh_tokens', 'users'],
    rabbitmq: true,
    redis: true,
  });

  async function createOrder(token: string): Promise<string> {
    const response = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return (response.body as OrderResponseDTO).id;
  }

  function getOrder(token: string, id: string) {
    return request(ctx.app.getHttpServer())
      .get(`/orders/${id}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function listOrders(token: string) {
    return request(ctx.app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${token}`);
  }

  it('serves a repeated read from cache, staying stable until invalidated', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    // First read populates the cache.
    const first = await getOrder(token, id).expect(200);
    expect((first.body as OrderResponseDTO).status).toBe(OrderStatus.PENDING);

    // Mutate the row directly, bypassing the service (so no invalidation fires).
    await ctx.dataSource.query(
      `UPDATE "orders" SET status = '${OrderStatus.RESERVED}' WHERE id = $1`,
      [id],
    );

    // The read is still served from cache — proving it didn't hit the DB.
    const second = await getOrder(token, id).expect(200);
    expect((second.body as OrderResponseDTO).status).toBe(OrderStatus.PENDING);
  });

  it('invalidates the cache on a transition so the next read is fresh', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    // Populate the cache with the PENDING state.
    await getOrder(token, id).expect(200);

    // Transition through the service, which invalidates order:{id}.
    await ctx.app.get(OrdersService).transitionOrder(id, OrderStatus.RESERVED);

    const fresh = await getOrder(token, id).expect(200);
    expect((fresh.body as OrderResponseDTO).status).toBe(OrderStatus.RESERVED);
  });

  it('serves the order list from cache, staying stable until invalidated', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    // First list read caches orders:user:{userId}.
    const first = await listOrders(token).expect(200);
    expect((first.body as OrderResponseDTO[]).length).toBe(1);

    // Delete the row directly, bypassing the service (so no invalidation fires).
    await ctx.dataSource.query(`DELETE FROM "orders" WHERE id = $1`, [id]);

    // The list is still served from cache — proving it didn't hit the DB.
    const second = await listOrders(token).expect(200);
    expect((second.body as OrderResponseDTO[]).length).toBe(1);
  });

  it('invalidates the list cache when the user creates another order', async () => {
    const token = await registerAndLogin(ctx.app);
    await createOrder(token);

    // Cache the single-order list.
    const first = await listOrders(token).expect(200);
    expect((first.body as OrderResponseDTO[]).length).toBe(1);

    // Creating another order through the service invalidates the list.
    await createOrder(token);

    const second = await listOrders(token).expect(200);
    expect((second.body as OrderResponseDTO[]).length).toBe(2);
  });

  it('does not leak a cached order to another user', async () => {
    const ownerToken = await registerAndLogin(ctx.app, {
      email: 'owner@example.com',
    });
    const id = await createOrder(ownerToken);

    // Owner caches the order.
    await getOrder(ownerToken, id).expect(200);

    // A different user must still get a 404 — the by-id cache is owner-checked.
    const otherToken = await registerAndLogin(ctx.app, {
      email: 'intruder@example.com',
    });
    await getOrder(otherToken, id).expect(404);
  });

  // Story 4.3 — performance & hit-rate proof. Asserts the deterministic facts
  // (hits recorded, invalidation forces a miss) and logs the cold-vs-warm
  // latency so the improvement is visible without a flaky timing assertion.
  it('records a high hit rate and faster warm reads than cold reads', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    const cache = ctx.app.get(CacheService);
    const key = `order:${id}`;
    const samples = 15;

    const before = cache.getStats().byClass.order ?? { hits: 0, misses: 0 };

    // Cold reads: invalidate first so each read misses and repopulates (DB hit).
    let coldTotal = 0;
    for (let i = 0; i < samples; i += 1) {
      await cache.del(key);
      const start = performance.now();
      await getOrder(token, id).expect(200);
      coldTotal += performance.now() - start;
    }

    // Warm reads: the entry stays put, so each is a cache hit.
    let warmTotal = 0;
    for (let i = 0; i < samples; i += 1) {
      const start = performance.now();
      await getOrder(token, id).expect(200);
      warmTotal += performance.now() - start;
    }

    const after = cache.getStats().byClass.order ?? {
      hits: 0,
      misses: 0,
      hitRate: 0,
    };
    const coldAvg = coldTotal / samples;
    const warmAvg = warmTotal / samples;

    console.log(
      `[cache benchmark] cold avg ${coldAvg.toFixed(2)}ms vs warm avg ` +
        `${warmAvg.toFixed(2)}ms; order hit rate ${(after.hitRate * 100).toFixed(0)}%`,
    );

    // Each cold read counted a miss; each warm read counted a hit.
    expect(after.hits - before.hits).toBe(samples);
    expect(after.misses - before.misses).toBe(samples);
    // Warm reads (Redis only) are faster than cold reads (Redis + Postgres).
    expect(warmAvg).toBeLessThan(coldAvg);
  });

  it('an order update is observably followed by a cache miss', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    const cache = ctx.app.get(CacheService);

    await getOrder(token, id).expect(200); // populate
    await getOrder(token, id).expect(200); // hit

    const beforeMisses = cache.getStats().byClass.order?.misses ?? 0;

    // A transition invalidates order:{id}, so the next read must miss.
    await ctx.app.get(OrdersService).transitionOrder(id, OrderStatus.RESERVED);
    await getOrder(token, id).expect(200);

    expect(cache.getStats().byClass.order?.misses ?? 0).toBe(beforeMisses + 1);
  });
});
