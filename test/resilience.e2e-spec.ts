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
import { ORDER_DLQ } from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

const gatewayMock = { authorize: jest.fn() };

describe('Resilience (e2e)', () => {
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

  async function createOrder(): Promise<string> {
    const token = await registerAndLogin(ctx.app);
    const created = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return (created.body as OrderResponseDTO).id;
  }

  it('retries a poison message a bounded number of times, then dead-letters it to the DLQ', async () => {
    // Payment always throws → the InventoryReserved message can never be
    // processed and should end up in the DLQ after the bounded retries.
    gatewayMock.authorize.mockRejectedValue(new Error('gateway exploded'));

    const id = await createOrder();

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

    const id = await createOrder();

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
