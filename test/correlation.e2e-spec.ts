import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import {
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Proves Story 5.2: a request adopts/echoes a correlation id, and the id rides
 * across the broker so a downstream consumer continues the same trace — here the
 * inventory consumer re-publishes InventoryReserved carrying the original id.
 */
describe('Correlation IDs (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      ProcessedMessageEntity,
    ],
    imports: [AuthModule, OrdersModule, InventoryModule],
    truncate: ['processed_messages', 'orders', 'refresh_tokens', 'users'],
    rabbitmq: true,
  });

  /** Binds a throwaway queue to InventoryReserved; bind before triggering work. */
  async function bindReservedQueue(): Promise<string> {
    const amqp = ctx.app.get(AmqpConnection);
    const { queue } = await amqp.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    await amqp.channel.bindQueue(
      queue,
      ORDER_EXCHANGE,
      OrderRoutingKey.InventoryReserved,
    );
    return queue;
  }

  /** Correlation header of the first message to land on the bound queue. */
  async function correlationIdOn(queue: string): Promise<string | undefined> {
    const amqp = ctx.app.get(AmqpConnection);
    let header: string | undefined;
    await waitFor(async () => {
      const msg = await amqp.channel.get(queue, { noAck: true });
      if (!msg) return false;
      header = msg.properties.headers?.[CORRELATION_HEADER] as
        | string
        | undefined;
      return true;
    });
    return header;
  }

  it('echoes a supplied correlation id and propagates it across the broker', async () => {
    const token = await registerAndLogin(ctx.app);
    const queue = await bindReservedQueue();

    const correlationId = 'cid-e2e-abc';
    const response = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .set(CORRELATION_HEADER, correlationId)
      .expect(201);

    expect(response.headers[CORRELATION_HEADER]).toBe(correlationId);
    // The inventory consumer re-entered the same context and kept the id.
    await expect(correlationIdOn(queue)).resolves.toBe(correlationId);
  });

  it('generates a correlation id when the request supplies none', async () => {
    const token = await registerAndLogin(ctx.app, {
      email: 'nocid@example.com',
    });

    const response = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const header = response.headers[CORRELATION_HEADER];
    expect(header).toBeDefined();
    expect(header.length).toBeGreaterThan(0);
  });
});
