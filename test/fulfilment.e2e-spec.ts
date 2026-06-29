import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { PaymentModule } from '@/modules/payment/payment.module';
import { CompletionModule } from '@/modules/completion/completion.module';
import { EmailModule } from '@/modules/email/email.module';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  ORDER_EXCHANGE,
  OrderCompletedEvent,
  OrderFailedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

// Controllable stand-in for the payment gateway (overridden into the app).
const gatewayMock = { authorize: jest.fn() };

describe('Order fulfilment chain (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      ProcessedMessageEntity,
    ],
    imports: [
      AuthModule,
      OrdersModule,
      InventoryModule,
      PaymentModule,
      CompletionModule,
      EmailModule,
    ],
    truncate: ['processed_messages', 'orders', 'refresh_tokens', 'users'],
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

  async function createOrder(): Promise<string> {
    const token = await registerAndLogin(ctx.app);
    const created = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return (created.body as OrderResponseDTO).id;
  }

  it('drives the full happy path to COMPLETED, emits OrderCompleted, and notifies once', async () => {
    const { event: completed } = await captureEvent<OrderCompletedEvent>(
      OrderRoutingKey.Completed,
    );

    const id = await createOrder();

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

    const id = await createOrder();

    await waitFor(async () => (await orderStatus(id)) === OrderStatus.FAILED, {
      timeoutMs: 20000,
    });
    expect((await failed).orderId).toBe(id);

    await waitFor(async () => (await emailReactions()) === 1, {
      timeoutMs: 5000,
    });
  });
});
