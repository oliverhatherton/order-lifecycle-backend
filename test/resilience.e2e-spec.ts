import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
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
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import { ORDER_DLQ } from '@/modules/messaging/events/order-events';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
  waitFor,
} from '@test/support/e2e';

const gatewayMock = { authorize: jest.fn() };

describe('Resilience (e2e)', () => {
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
      OutboxMessageEntity,
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
    overrides: [{ provide: PaymentGateway, useValue: gatewayMock }],
  });

  beforeEach(async () => {
    gatewayMock.authorize.mockReset();
    gatewayMock.authorize.mockResolvedValue({ authorized: true });
    // The DLQ is a broker queue, not a DB table — purge it for test isolation.
    await ctx.app.get(AmqpConnection).channel.purgeQueue(ORDER_DLQ);
  });

  async function orderStatus(id: string): Promise<OrderStatus | undefined> {
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneBy({ id });
    return order?.status;
  }

  async function dlqDepth(): Promise<number> {
    const info = await ctx.app
      .get(AmqpConnection)
      .channel.checkQueue(ORDER_DLQ);
    return info.messageCount;
  }

  async function createOrder(): Promise<{ id: string; token: string }> {
    const token = await registerAndLogin(ctx.app);
    const productId = await createProduct(ctx.dataSource);
    const order = await createOrderViaCart(ctx.app, token, productId);
    return { id: order.id, token };
  }

  /** Waits for RESERVED, then confirms payment — the UI's "Pay" click. */
  async function pay(id: string, token: string): Promise<void> {
    await waitFor(async () => (await orderStatus(id)) === OrderStatus.RESERVED);
    await request(ctx.app.getHttpServer())
      .post(`/orders/${id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  it('retries a poison message a bounded number of times, then dead-letters it to the DLQ', async () => {
    // Payment always throws → the InventoryReserved message can never be
    // processed and should end up in the DLQ after the bounded retries.
    gatewayMock.authorize.mockRejectedValue(new Error('gateway exploded'));

    const { id, token } = await createOrder();
    await pay(id, token);

    await waitFor(async () => (await dlqDepth()) >= 1, { timeoutMs: 20000 });

    // 1 initial delivery + 3 retries.
    expect(gatewayMock.authorize).toHaveBeenCalledTimes(4);
    // The order was reserved but never advanced past RESERVED.
    expect(await orderStatus(id)).toBe(OrderStatus.RESERVED);
  });

  it('recovers from a transient failure on retry without double-processing', async () => {
    // Fail once (as if the consumer crashed mid-flow), then succeed.
    gatewayMock.authorize
      .mockRejectedValueOnce(new Error('transient blip'))
      .mockResolvedValue({ authorized: true });

    const { id, token } = await createOrder();
    await pay(id, token);

    await waitFor(
      async () => (await orderStatus(id)) === OrderStatus.COMPLETED,
      { timeoutMs: 20000 },
    );

    // Two authorize calls (one failure + one success), and the payment side
    // effect was applied exactly once despite the redelivery.
    expect(gatewayMock.authorize).toHaveBeenCalledTimes(2);
    const paymentReactions = await ctx.dataSource
      .getRepository(ProcessedMessageEntity)
      .countBy({ consumer: 'payment' });
    expect(paymentReactions).toBe(1);
    // Nothing was dead-lettered on the recoverable path.
    expect(await dlqDepth()).toBe(0);
  });
});
