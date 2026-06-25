import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  InventoryReservedEvent,
  OrderCreatedEvent,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest, waitFor } from '@test/support/e2e';

describe('Inventory consumer (e2e)', () => {
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

  it('reserves inventory: OrderCreated → order RESERVED → InventoryReserved', async () => {
    const amqp = ctx.app.get(AmqpConnection);

    // Capture the InventoryReserved the consumer will emit.
    const { queue } = await amqp.channel.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    await amqp.channel.bindQueue(
      queue,
      ORDER_EXCHANGE,
      OrderRoutingKey.InventoryReserved,
    );
    const reserved = new Promise<InventoryReservedEvent>((resolve) => {
      void amqp.channel.consume(
        queue,
        (msg) => {
          if (msg) {
            resolve(
              JSON.parse(msg.content.toString()) as InventoryReservedEvent,
            );
          }
        },
        { noAck: true },
      );
    });

    const token = await registerAndLogin(ctx.app);
    const created = await request(ctx.app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const { id } = created.body as OrderResponseDTO;

    const event = await reserved;
    expect(event.orderId).toBe(id);

    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .findOneByOrFail({ id });
    expect(order.status).toBe(OrderStatus.RESERVED);
  });

  it('is idempotent: a redelivered OrderCreated reserves only once', async () => {
    // A user + a PENDING order created directly, so the only OrderCreated
    // messages are the crafted (identical) ones we publish below.
    await registerAndLogin(ctx.app);
    const user = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'test@example.com' });
    const order = await ctx.dataSource
      .getRepository(OrderEntity)
      .save(
        ctx.dataSource.getRepository(OrderEntity).create({ userId: user.id }),
      );

    const amqp = ctx.app.get(AmqpConnection);
    const event: OrderCreatedEvent = {
      orderId: order.id,
      userId: user.id,
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
  });
});
