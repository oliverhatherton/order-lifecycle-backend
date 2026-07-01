import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { PaymentModule } from '@/modules/payment/payment.module';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  ORDER_EXCHANGE,
  OrderFailedEvent,
  OrderRoutingKey,
  PaymentProcessedEvent,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

// Controllable stand-in for the payment gateway (overridden into the app).
const gatewayMock = { authorize: jest.fn() };

describe('Payment fulfilment (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      ProcessedMessageEntity,
      PaymentAuthorizationEntity,
    ],
    imports: [AuthModule, OrdersModule, InventoryModule, PaymentModule],
    truncate: [
      'payment_authorizations',
      'processed_messages',
      'orders',
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

  /**
   * Binds a throwaway queue to a routing key. Returns `{ event }` — a promise
   * for the first message — wrapped in an object so awaiting the setup does not
   * also await the (not-yet-published) event.
   */
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

  async function createOrder(): Promise<string> {
    const token = await registerAndLogin(ctx.app);
    const created = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return (created.body as OrderResponseDTO).id;
  }

  it('drives a paid order end-to-end (PENDING → RESERVED → PAID) and emits PaymentProcessed', async () => {
    const { event: paid } = await captureEvent<PaymentProcessedEvent>(
      OrderRoutingKey.PaymentProcessed,
    );

    const id = await createOrder();

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.PAID, {
      timeoutMs: 15000,
    });
    expect((await paid).orderId).toBe(id);
  });

  it('fails an order on payment decline (→ FAILED) and emits OrderFailed', async () => {
    gatewayMock.authorize.mockResolvedValue({
      authorized: false,
      declineReason: 'card_declined',
    });
    const { event: failed } = await captureEvent<OrderFailedEvent>(
      OrderRoutingKey.Failed,
    );

    const id = await createOrder();

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.FAILED, {
      timeoutMs: 15000,
    });
    const event = await failed;
    expect(event.orderId).toBe(id);
    expect(event.reason).toBe('card_declined');
  });
});
