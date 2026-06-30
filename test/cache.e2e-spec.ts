import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import { registerAndLogin, setupE2eTest } from '@test/support/e2e';

/**
 * Proves the Story 4.1 cache-aside behaviour against a real Redis container:
 * a repeated read is served from cache, a state transition invalidates it, and
 * the by-id cache never leaks an order across users.
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
});
