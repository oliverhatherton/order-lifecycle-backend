import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import request from 'supertest';
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
import {
  ORDER_EXCHANGE,
  OrderCompletedEvent,
  OrderFailedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
  waitFor,
} from '@test/support/e2e';

// Controllable stand-in for the payment gateway (overridden into the app).
const gatewayMock = { authorize: jest.fn() };

describe('Order fulfilment chain (e2e)', () => {
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

  beforeEach(() => {
    gatewayMock.authorize.mockReset();
    gatewayMock.authorize.mockResolvedValue({ authorized: true });
  });

  async function orderStatus(id: string): Promise<OrderStatus | undefined> {
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneBy({ id });
    return order?.status;
  }

  async function emailReactions(): Promise<number> {
    return ctx.dataSource
      .getRepository(ProcessedMessageEntity)
      .countBy({ consumer: 'email' });
  }

  async function captureEvent<T>(
    routingKey: string,
  ): Promise<{ event: Promise<T> }> {
    const amqp = ctx.app.get(AmqpConnection);
    const { queue } = await amqp.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    await amqp.channel.bindQueue(queue, ORDER_EXCHANGE, routingKey);
    const event = new Promise<T>((resolve) => {
      void amqp.channel.consume(
        queue,
        (msg) => {
          if (msg) resolve(JSON.parse(msg.content.toString()) as T);
        },
        { noAck: true },
      );
    });
    return { event };
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

  it('drives the full happy path to COMPLETED, emits OrderCompleted, and notifies once', async () => {
    const { event: completed } = await captureEvent<OrderCompletedEvent>(
      OrderRoutingKey.Completed,
    );

    const { id, token } = await createOrder();
    await pay(id, token);

    await waitFor(
      async () => (await orderStatus(id)) === OrderStatus.COMPLETED,
      { timeoutMs: 20000 },
    );
    expect((await completed).orderId).toBe(id);

    // The email consumer reacted to the terminal event exactly once.
    await waitFor(async () => (await emailReactions()) === 1, {
      timeoutMs: 5000,
    });
  });

  it('notifies on a failed order (decline → FAILED → OrderFailed → email)', async () => {
    gatewayMock.authorize.mockResolvedValue({
      authorized: false,
      declineReason: 'card_declined',
    });
    const { event: failed } = await captureEvent<OrderFailedEvent>(
      OrderRoutingKey.Failed,
    );

    const { id, token } = await createOrder();
    await pay(id, token);

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.FAILED, {
      timeoutMs: 20000,
    });
    expect((await failed).orderId).toBe(id);

    await waitFor(async () => (await emailReactions()) === 1, {
      timeoutMs: 5000,
    });
  });
});
