import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { PaymentModule } from '@/modules/payment/payment.module';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import {
  ORDER_EXCHANGE,
  InventoryReservedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

/**
 * Stretch goal — payment idempotency. The inbox already makes the order
 * transition once-only, but `authorize` runs before that transaction, so a
 * crash-then-redelivery would re-charge. This proves the gateway charges once
 * per order: redelivering the same InventoryReserved leaves a single
 * authorization and a single charge, with the order still PAID.
 *
 * Also covers the two cases a check-then-charge scheme gets wrong: two
 * deliveries racing (both would see "no decision yet" and both charge), and a
 * crash between charging and recording the decision (a stale claim).
 *
 * Only Auth/Orders/Payment are imported (no inventory consumer), so the order is
 * driven to RESERVED by hand and payment is the sole consumer of the event.
 */
// Keep the in-flight retry loop quick; production backoff is 1s/2s/4s.
process.env.RABBITMQ_RETRY_BASE_DELAY_MS = '200';

describe('Payment idempotency (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      ProcessedMessageEntity,
      PaymentAuthorizationEntity,
      OutboxMessageEntity,
    ],
    imports: [AuthModule, OrdersModule, PaymentModule],
    truncate: [
      'payment_authorizations',
      'processed_messages',
      'outbox_messages',
      'order_items',
      'orders',
      'refresh_tokens',
      'users',
    ],
    rabbitmq: true,
  });

  afterEach(() => jest.restoreAllMocks());

  function publishReserved(event: InventoryReservedEvent, messageId: string) {
    return ctx.app
      .get(AmqpConnection)
      .publish(ORDER_EXCHANGE, OrderRoutingKey.InventoryReserved, event, {
        messageId,
        persistent: true,
      });
  }

  async function orderStatus(id: string): Promise<OrderStatus | undefined> {
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneBy({ id });
    return order?.status;
  }

  function authorizationCount(orderId: string): Promise<number> {
    return ctx.dataSource
      .getRepository(PaymentAuthorizationEntity)
      .countBy({ orderId });
  }

  it('charges once per order even when InventoryReserved is redelivered', async () => {
    await registerAndLogin(ctx.app);
    const user = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'test@example.com' });
    const userId = user.id;

    // Created directly (no cart needed — this test only cares about the
    // RESERVED -> PAID leg, driven entirely by hand).
    const order = await ctx.app.get(OrdersService).createOrder(userId, []);
    const id = order.id;

    // Move to RESERVED so payment's RESERVED → PAID transition is legal.
    await ctx.app.get(OrdersService).transitionOrder(id, OrderStatus.RESERVED);

    const charge = jest.spyOn(ctx.app.get(PaymentGateway), 'charge');
    const event: InventoryReservedEvent = {
      orderId: id,
      userId,
      occurredAt: new Date().toISOString(),
    };

    // First delivery authorizes and pays.
    await publishReserved(event, 'idem-redeliver');
    await waitFor(async () => (await orderStatus(id)) === OrderStatus.PAID);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await authorizationCount(id)).toBe(1);

    // Redeliver the identical message (same messageId, same order).
    await publishReserved(event, 'idem-redeliver');
    // Let the redelivery be consumed; it must be a no-op (idempotent).
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(charge).toHaveBeenCalledTimes(1); // not re-charged
    expect(await authorizationCount(id)).toBe(1); // single ledger entry
    expect(await orderStatus(id)).toBe(OrderStatus.PAID); // unchanged
  });

  /** Creates an order and moves it to RESERVED by hand. */
  async function reservedOrder(): Promise<{ id: string; userId: string }> {
    await registerAndLogin(ctx.app);
    const user = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'test@example.com' });
    const order = await ctx.app.get(OrdersService).createOrder(user.id, []);
    await ctx.app
      .get(OrdersService)
      .transitionOrder(order.id, OrderStatus.RESERVED);
    return { id: order.id, userId: user.id };
  }

  it('charges once when the same InventoryReserved is delivered twice concurrently', async () => {
    const { id, userId } = await reservedOrder();
    const gateway = ctx.app.get(PaymentGateway);
    // A slow provider call widens the race window: the second delivery is
    // guaranteed to arrive while the first is still mid-charge.
    const charge = jest
      .spyOn(gateway, 'charge')
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ authorized: true }), 500),
          ),
      );
    const event: InventoryReservedEvent = {
      orderId: id,
      userId,
      occurredAt: new Date().toISOString(),
    };

    await Promise.all([
      publishReserved(event, 'idem-concurrent'),
      publishReserved(event, 'idem-concurrent'),
    ]);

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.PAID, {
      timeoutMs: 10000,
    });
    // Give the losing delivery time to retry and settle as a no-op.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(charge).toHaveBeenCalledTimes(1);
    expect(await authorizationCount(id)).toBe(1);
    expect(await orderStatus(id)).toBe(OrderStatus.PAID);
  });

  it('recovers a claim left undecided by a crash, re-calling the provider with the same idempotency key', async () => {
    const { id, userId } = await reservedOrder();
    // Simulate a delivery that claimed, (maybe) charged, then died before
    // recording the decision — a minute ago.
    await ctx.dataSource.query(
      `INSERT INTO "payment_authorizations" ("orderId", "authorized", "createdAt")
       VALUES ($1, NULL, now()::timestamp - interval '1 minute')`,
      [id],
    );
    const charge = jest.spyOn(ctx.app.get(PaymentGateway), 'charge');

    await publishReserved(
      { orderId: id, userId, occurredAt: new Date().toISOString() },
      'idem-stale',
    );

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.PAID);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][1]).toBe(id); // same key the crashed attempt used
    const stored = await ctx.dataSource
      .getRepository(PaymentAuthorizationEntity)
      .findOneByOrFail({ orderId: id });
    expect(stored.authorized).toBe(true);
  });
});
