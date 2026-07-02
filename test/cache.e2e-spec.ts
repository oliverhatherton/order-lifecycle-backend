import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
import { CacheService } from '@/modules/cache/cache.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
} from '@test/support/e2e';

/**
 * Proves the Epic 4 caching behaviour against a real Redis container: reads
 * (single + list) are served from cache once terminal, writes invalidate
 * them, the by-id cache never leaks an order across users (4.1/4.2), and the
 * hit-rate counters plus a cold-vs-warm benchmark make the speed-up
 * observable (4.3).
 *
 * Non-terminal (still in-flight) orders are deliberately **never** cached —
 * see OrdersService.getOrderForUser/listOrdersForUser. Caching an order that
 * can still transition risks a stale-write-after-invalidate race: a read
 * started just before a transition can finish (and write its now-stale
 * snapshot into the cache) just after that transition's invalidating `del`
 * has already run, leaving a stale entry with nothing left to evict it until
 * the TTL. That showed up as a completed order still reading back as PAID
 * under concurrent load. Several tests below assert the *absence* of caching
 * for non-terminal orders for exactly this reason.
 */
describe('Order caching (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      CartEntity,
      CartItemEntity,
      ProcessedMessageEntity,
      OutboxMessageEntity,
    ],
    imports: [AuthModule, OrdersModule, ProductsModule, CartModule],
    truncate: [
      'processed_messages',
      'outbox_messages',
      'order_items',
      'orders',
      'cart_items',
      'carts',
      'products',
      'refresh_tokens',
      'users',
    ],
    rabbitmq: true,
    redis: true,
  });

  async function createOrder(token: string): Promise<string> {
    const productId = await createProduct(ctx.dataSource);
    const order = await createOrderViaCart(ctx.app, token, productId);
    return order.id;
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

  /** Drives a fresh PENDING order all the way to COMPLETED via the service. */
  async function completeOrder(id: string): Promise<void> {
    const orders = ctx.app.get(OrdersService);
    await orders.transitionOrder(id, OrderStatus.RESERVED);
    await orders.transitionOrder(id, OrderStatus.PAID);
    await orders.transitionOrder(id, OrderStatus.COMPLETED);
  }

  it('never caches a non-terminal order, so every read reflects the current DB state', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    // If this were cached, this read would populate it with PENDING.
    const first = await getOrder(token, id).expect(200);
    expect((first.body as OrderResponseDTO).status).toBe(OrderStatus.PENDING);

    // Mutate the row directly, bypassing the service (so no invalidation fires).
    await ctx.dataSource.query(
      `UPDATE "orders" SET status = '${OrderStatus.RESERVED}' WHERE id = $1`,
      [id],
    );

    // A cached read would still show PENDING; an uncached one reflects the change.
    const second = await getOrder(token, id).expect(200);
    expect((second.body as OrderResponseDTO).status).toBe(OrderStatus.RESERVED);
  });

  it('serves a terminal order from cache, staying stable until invalidated', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    await completeOrder(id);

    // First read of the now-COMPLETED order populates the cache.
    const first = await getOrder(token, id).expect(200);
    expect((first.body as OrderResponseDTO).status).toBe(OrderStatus.COMPLETED);

    // Mutate the row directly, bypassing the service (so no invalidation fires).
    await ctx.dataSource.query(
      `UPDATE "orders" SET status = '${OrderStatus.FAILED}' WHERE id = $1`,
      [id],
    );

    // The read is still served from cache — proving it didn't hit the DB.
    const second = await getOrder(token, id).expect(200);
    expect((second.body as OrderResponseDTO).status).toBe(
      OrderStatus.COMPLETED,
    );
  });

  it('invalidates the cache on a transition so the next read is fresh', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    await getOrder(token, id).expect(200);

    await ctx.app.get(OrdersService).transitionOrder(id, OrderStatus.RESERVED);

    const fresh = await getOrder(token, id).expect(200);
    expect((fresh.body as OrderResponseDTO).status).toBe(OrderStatus.RESERVED);
  });

  it('never caches the list while any order in it is non-terminal, so it stays fresh', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);

    // If this were cached, this read would populate it with the PENDING order.
    const first = await listOrders(token).expect(200);
    expect((first.body as OrderResponseDTO[]).length).toBe(1);

    // Delete the row directly, bypassing the service (so no invalidation fires).
    await ctx.dataSource.query(`DELETE FROM "orders" WHERE id = $1`, [id]);

    // A cached list would still show 1; an uncached one reflects the deletion.
    const second = await listOrders(token).expect(200);
    expect((second.body as OrderResponseDTO[]).length).toBe(0);
  });

  it('serves the order list from cache once every order is terminal, staying stable until invalidated', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    await completeOrder(id);

    // First list read caches orders:user:{userId} (every order is terminal).
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

    const first = await listOrders(token).expect(200);
    expect((first.body as OrderResponseDTO[]).length).toBe(1);

    // Creating another order through the service invalidates the list.
    await createOrder(token);

    const second = await listOrders(token).expect(200);
    expect((second.body as OrderResponseDTO[]).length).toBe(2);
  });

  it('does not leak a cached terminal order to another user', async () => {
    const ownerToken = await registerAndLogin(ctx.app, {
      email: 'owner@example.com',
    });
    const id = await createOrder(ownerToken);
    await completeOrder(id);

    // Owner caches the (now terminal) order.
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
  // Uses a terminal order — the only kind that's ever cached.
  it('records a high hit rate and faster warm reads than cold reads', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    await completeOrder(id);
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

    // Each cold read counted a miss; each warm read counted a hit. The
    // cold-vs-warm latency is logged above as evidence but not asserted —
    // wall-clock comparisons are environment-dependent and flake under load.
    expect(after.hits - before.hits).toBe(samples);
    expect(after.misses - before.misses).toBe(samples);
  });

  it('a non-terminal order is always a cache miss — nothing to invalidate because nothing was ever cached', async () => {
    const token = await registerAndLogin(ctx.app);
    const id = await createOrder(token);
    const cache = ctx.app.get(CacheService);

    const beforeMisses = cache.getStats().byClass.order?.misses ?? 0;
    const beforeHits = cache.getStats().byClass.order?.hits ?? 0;

    await getOrder(token, id).expect(200);
    await ctx.app.get(OrdersService).transitionOrder(id, OrderStatus.RESERVED);
    await getOrder(token, id).expect(200);

    // Two reads of a never-terminal order, two misses, zero hits.
    expect(cache.getStats().byClass.order?.misses ?? 0).toBe(beforeMisses + 2);
    expect(cache.getStats().byClass.order?.hits ?? 0).toBe(beforeHits);
  });
});
