import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { ORDER_EXCHANGE, OrderRoutingKey } from '@/modules/messaging/events/order-events';
import type { OrderCreatedEvent, OrderFailedEvent } from '@/modules/messaging/events/order-events';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
  waitFor,
} from '@test/support/e2e';

describe('Inventory consumer (e2e)', () => {
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
    ],
    imports: [AuthModule, OrdersModule, InventoryModule, ProductsModule, CartModule],
    truncate: [
      'processed_messages',
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

  it('reserves inventory: OrderCreated → order RESERVED, then pauses (no auto-publish)', async () => {
    const token = await registerAndLogin(ctx.app);
    const productId = await createProduct(ctx.dataSource, { stock: 10 });
    const { id } = await createOrderViaCart(ctx.app, token, productId, 2);

    await waitFor(async () => {
      const order = await ctx.dataSource
        .getRepository(OrderEntity)
        .findOneByOrFail({ id });
      return order.status === OrderStatus.RESERVED;
    });

    // Stock was actually decremented, not just simulated.
    const product = await ctx.dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ id: productId });
    expect(product.stock).toBe(8);

    // Confirms the pause: the order sits in RESERVED and never advances on
    // its own — resuming the chain now requires POST /orders/:id/pay.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneByOrFail({ id });
    expect(order.status).toBe(OrderStatus.RESERVED);
  });

  it('fails the order (insufficient_stock) and does not decrement when stock is short', async () => {
    const token = await registerAndLogin(ctx.app, {
      email: 'short-stock@example.com',
    });
    const productId = await createProduct(ctx.dataSource, { stock: 1 });

    const amqp = ctx.app.get(AmqpConnection);
    const { queue } = await amqp.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    await amqp.channel.bindQueue(queue, ORDER_EXCHANGE, OrderRoutingKey.Failed);
    const failed = new Promise<OrderFailedEvent>((resolve) => {
      void amqp.channel.consume(
        queue,
        (msg) => {
          if (msg) resolve(JSON.parse(msg.content.toString()) as OrderFailedEvent);
        },
        { noAck: true },
      );
    });

    const { id } = await createOrderViaCart(ctx.app, token, productId, 5);

    await waitFor(async () => {
      const order = await ctx.dataSource
        .getRepository(OrderEntity)
        .findOneByOrFail({ id });
      return order.status === OrderStatus.FAILED;
    });
    expect((await failed).reason).toBe('insufficient_stock');

    // Nothing was left decremented.
    const product = await ctx.dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ id: productId });
    expect(product.stock).toBe(1);
  });

  it('is idempotent: a redelivered OrderCreated reserves only once', async () => {
    // A user + a PENDING order created directly, so the only OrderCreated
    // messages are the crafted (identical) ones we publish below.
    await registerAndLogin(ctx.app);
    const user = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'test@example.com' });
    const productId = await createProduct(ctx.dataSource, { stock: 10 });
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .save(
        ctx.dataSource.getRepository(OrderEntity).create({ userId: user.id }),
      );

    const amqp = ctx.app.get(AmqpConnection);
    const event: OrderCreatedEvent = {
      orderId: order.id,
      userId: user.id,
      items: [{ productId, quantity: 1 }],
      occurredAt: new Date().toISOString(),
    };
    // Same messageId twice = a redelivery.
    await amqp.publish(ORDER_EXCHANGE, OrderRoutingKey.Created, event, {
      messageId: 'fixed-msg-1',
      persistent: true,
    });
    await amqp.publish(ORDER_EXCHANGE, OrderRoutingKey.Created, event, {
      messageId: 'fixed-msg-1',
      persistent: true,
    });

    await waitFor(async () => {
      const current = await ctx.dataSource
        .getRepository(OrderEntity)
        .findOneByOrFail({ id: order.id });
      return current.status === OrderStatus.RESERVED;
    });

    // The inbox guarantees exactly one processed record for the message.
    const processed = await ctx.dataSource
      .getRepository(ProcessedMessageEntity)
      .countBy({ messageId: 'fixed-msg-1', consumer: 'inventory' });
    expect(processed).toBe(1);

    // And stock was only decremented once, not twice.
    const product = await ctx.dataSource
      .getRepository(ProductEntity)
      .findOneByOrFail({ id: productId });
    expect(product.stock).toBe(9);
  });
});
