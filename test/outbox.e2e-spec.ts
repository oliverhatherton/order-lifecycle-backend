import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
import { EventPublisher } from '@/modules/messaging/event-publisher';
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
import { OrderRoutingKey } from '@/modules/messaging/events/order-events';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
  waitFor,
} from '@test/support/e2e';

/**
 * Proves the outbox pattern actually closes the dual-write gap it exists
 * for: OrdersService.createOrder no longer publishes to RabbitMQ inline —
 * it writes an outbox row in the same DB transaction as the order, and
 * OutboxRelayService delivers it afterwards, on its own schedule, retrying
 * indefinitely until the broker accepts it.
 */
describe('Transactional outbox (e2e)', () => {
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
    imports: [
      AuthModule,
      OrdersModule,
      InventoryModule,
      ProductsModule,
      CartModule,
    ],
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function orderStatus(id: string): Promise<OrderStatus | undefined> {
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneBy({ id });
    return order?.status;
  }

  function outboxRowFor(orderId: string): Promise<OutboxMessageEntity | null> {
    return ctx.dataSource
      .getRepository(OutboxMessageEntity)
      .createQueryBuilder('outbox')
      .where('outbox.routingKey = :routingKey', {
        routingKey: OrderRoutingKey.Created,
      })
      .andWhere("outbox.payload ->> 'orderId' = :orderId", { orderId })
      .getOne();
  }

  it('durably queues OrderCreated and the relay delivers it, advancing the order asynchronously', async () => {
    const token = await registerAndLogin(ctx.app);
    const productId = await createProduct(ctx.dataSource);
    const order = await createOrderViaCart(ctx.app, token, productId);

    // The event is queryable in Postgres the instant the request returns —
    // no dependency on the broker being reachable at all.
    const queuedRow = await outboxRowFor(order.id);
    expect(queuedRow).not.toBeNull();
    expect(queuedRow?.payload).toMatchObject({ orderId: order.id });

    // InventoryConsumer only reaches RESERVED by consuming OrderCreated off
    // the broker — reaching it proves the relay actually delivered the row.
    await waitFor(
      async () => (await orderStatus(order.id)) === OrderStatus.RESERVED,
      { timeoutMs: 15000 },
    );

    const relayedRow = await outboxRowFor(order.id);
    expect(relayedRow?.publishedAt).not.toBeNull();
  });

  it('keeps retrying a publish failure until it succeeds, without losing the event', async () => {
    const publishSpy = jest.spyOn(ctx.app.get(EventPublisher), 'publish');
    // First two relay attempts fail (simulated broker hiccup); every call
    // after that falls through to the real implementation.
    publishSpy
      .mockRejectedValueOnce(new Error('broker unreachable'))
      .mockRejectedValueOnce(new Error('broker unreachable'));

    const token = await registerAndLogin(ctx.app, {
      email: 'outbox-retry@example.com',
    });
    const productId = await createProduct(ctx.dataSource);
    const order = await createOrderViaCart(ctx.app, token, productId);

    // The order exists and its event is queued despite the request never
    // touching the broker directly.
    expect(await orderStatus(order.id)).toBe(OrderStatus.PENDING);
    const queuedRow = await outboxRowFor(order.id);
    expect(queuedRow?.publishedAt).toBeNull();

    // Delivery still completes once the simulated outage clears.
    await waitFor(
      async () => (await orderStatus(order.id)) === OrderStatus.RESERVED,
      { timeoutMs: 15000 },
    );

    expect(publishSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    const relayedRow = await outboxRowFor(order.id);
    expect(relayedRow?.publishedAt).not.toBeNull();
  });
});
