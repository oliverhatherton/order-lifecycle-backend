import request from 'supertest';
import type { Counter } from 'prom-client';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { PaymentModule } from '@/modules/payment/payment.module';
import { CompletionModule } from '@/modules/completion/completion.module';
import { EmailModule } from '@/modules/email/email.module';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import {
  consumerMessagesTotal,
  dbQueryDuration,
  ordersTerminalTotal,
} from '@/modules/metrics/metrics.collectors';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
  waitFor,
} from '@test/support/e2e';

const gatewayMock = { authorize: jest.fn() };

/** Current value of a counter sample matching the given labels. */
async function counterValue(
  counter: Counter<string>,
  labels: Record<string, string>,
): Promise<number> {
  const metric = await counter.get();
  const sample = metric.values.find((value) =>
    Object.entries(labels).every(([key, val]) => value.labels[key] === val),
  );
  return sample?.value ?? 0;
}

/** Current `_count` of the db-query histogram (across all operations). */
async function dbQueryCount(): Promise<number> {
  const metric = await dbQueryDuration.get();
  return metric.values
    .filter((value) => value.metricName === 'db_query_duration_seconds_count')
    .reduce((total, value) => total + value.value, 0);
}

/**
 * Proves Story 5.3: driving the fulfilment chain moves the per-consumer,
 * terminal-state and DB-latency collectors — the metrics that answer "which
 * consumer ran?" and "is there a failure spike?".
 */
describe('Consumer & DB metrics (e2e)', () => {
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
      PaymentAuthorizationEntity,
    ],
    imports: [
      AuthModule,
      OrdersModule,
      InventoryModule,
      PaymentModule,
      CompletionModule,
      EmailModule,
      ProductsModule,
      CartModule,
    ],
    truncate: [
      'payment_authorizations',
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
    overrides: [{ provide: PaymentGateway, useValue: gatewayMock }],
  });

  beforeEach(() => {
    gatewayMock.authorize.mockReset();
    gatewayMock.authorize.mockResolvedValue({ authorized: true });
  });

  async function createOrder(token: string): Promise<string> {
    const productId = await createProduct(ctx.dataSource);
    const order = await createOrderViaCart(ctx.app, token, productId);
    return order.id;
  }

  async function orderStatus(id: string): Promise<OrderStatus | undefined> {
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneBy({ id });
    return order?.status;
  }

  /** Waits for RESERVED, then confirms payment — the UI's "Pay" click. */
  async function pay(id: string, token: string): Promise<void> {
    await waitFor(async () => (await orderStatus(id)) === OrderStatus.RESERVED);
    await request(ctx.app.getHttpServer())
      .post(`/orders/${id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  it('counts per-consumer processing, a completed order and DB queries', async () => {
    const token = await registerAndLogin(ctx.app);
    const inventoryBefore = await counterValue(consumerMessagesTotal, {
      consumer: 'inventory',
      outcome: 'processed',
    });
    const completedBefore = await counterValue(ordersTerminalTotal, {
      state: 'completed',
    });
    const dbBefore = await dbQueryCount();

    const id = await createOrder(token);
    await pay(id, token);
    await waitFor(
      async () => (await orderStatus(id)) === OrderStatus.COMPLETED,
    );

    const inventoryAfter = await counterValue(consumerMessagesTotal, {
      consumer: 'inventory',
      outcome: 'processed',
    });
    const completedAfter = await counterValue(ordersTerminalTotal, {
      state: 'completed',
    });

    expect(inventoryAfter).toBeGreaterThan(inventoryBefore);
    expect(completedAfter).toBeGreaterThan(completedBefore);
    expect(await dbQueryCount()).toBeGreaterThan(dbBefore);
  });

  it('counts a declined payment as a failed terminal order', async () => {
    gatewayMock.authorize.mockResolvedValue({
      authorized: false,
      declineReason: 'insufficient_funds',
    });
    const token = await registerAndLogin(ctx.app, {
      email: 'decline@example.com',
    });
    const failedBefore = await counterValue(ordersTerminalTotal, {
      state: 'failed',
    });

    const id = await createOrder(token);
    await pay(id, token);
    await waitFor(async () => (await orderStatus(id)) === OrderStatus.FAILED);

    const failedAfter = await counterValue(ordersTerminalTotal, {
      state: 'failed',
    });
    expect(failedAfter).toBeGreaterThan(failedBefore);
  });
});
