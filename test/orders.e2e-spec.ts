import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  InventoryReservedEvent,
  ORDER_EXCHANGE,
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import { registerAndLogin, setupE2eTest } from '@test/support/e2e';

describe('OrdersController (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      ProcessedMessageEntity,
    ],
    imports: [AuthModule, OrdersModule],
    truncate: ['processed_messages', 'orders', 'refresh_tokens', 'users'],
    rabbitmq: true,
  });

  describe('POST /orders', () => {
    it('creates a PENDING order owned by the authenticated caller', async () => {
      const token = await registerAndLogin(ctx.app);

      const response = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const body = response.body as OrderResponseDTO;
      expect(body.id).toBeDefined();
      expect(body.status).toBe(OrderStatus.PENDING);
      expect(body.userId).toBeDefined();
      expect(body.createdAt).toBeDefined();
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer()).post('/orders').expect(401);
    });

    it('publishes a typed OrderCreated event to the exchange', async () => {
      const amqp = ctx.app.get(AmqpConnection);

      // Bind a throwaway queue to the order-created routing key and capture the
      // first message that lands.
      const { queue } = await amqp.channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
      });
      await amqp.channel.bindQueue(
        queue,
        ORDER_EXCHANGE,
        OrderRoutingKey.Created,
      );
      const received = new Promise<OrderCreatedEvent>((resolve) => {
        void amqp.channel.consume(
          queue,
          (msg) => {
            if (msg) {
              resolve(JSON.parse(msg.content.toString()) as OrderCreatedEvent);
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
      const { id, userId } = created.body as OrderResponseDTO;

      const event = await received;
      expect(event.orderId).toBe(id);
      expect(event.userId).toBe(userId);
      expect(typeof event.occurredAt).toBe('string');
    });
  });

  describe('GET /orders', () => {
    async function createOrder(token: string): Promise<void> {
      await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    }

    it("returns only the caller's own orders, partitioned by user", async () => {
      const alice = await registerAndLogin(ctx.app, {
        email: 'alice@example.com',
      });
      const bob = await registerAndLogin(ctx.app, { email: 'bob@example.com' });
      await createOrder(alice);
      await createOrder(alice);
      await createOrder(bob);

      const aliceOrders = await request(ctx.app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${alice}`)
        .expect(200);
      const bobOrders = await request(ctx.app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${bob}`)
        .expect(200);

      const aliceBody = aliceOrders.body as OrderResponseDTO[];
      const bobBody = bobOrders.body as OrderResponseDTO[];
      expect(aliceBody).toHaveLength(2);
      expect(bobBody).toHaveLength(1);
      // Every returned order belongs to the requesting user only.
      const aliceUserIds = new Set(aliceBody.map((order) => order.userId));
      expect(aliceUserIds.size).toBe(1);
      expect(aliceUserIds.has(bobBody[0].userId)).toBe(false);
    });

    it('returns an empty list for a user with no orders', async () => {
      const token = await registerAndLogin(ctx.app);

      const response = await request(ctx.app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer()).get('/orders').expect(401);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns an order the caller owns', async () => {
      const token = await registerAndLogin(ctx.app);
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      const response = await request(ctx.app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as OrderResponseDTO).id).toBe(id);
    });

    it("returns 404 for another user's order (existence hidden)", async () => {
      const ownerToken = await registerAndLogin(ctx.app, {
        email: 'owner@example.com',
      });
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      const otherToken = await registerAndLogin(ctx.app, {
        email: 'other@example.com',
      });
      await request(ctx.app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns 404 for an unknown order id', async () => {
      const token = await registerAndLogin(ctx.app);

      await request(ctx.app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 400 for a malformed order id', async () => {
      const token = await registerAndLogin(ctx.app);

      await request(ctx.app.getHttpServer())
        .get('/orders/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });

  describe('POST /orders/:id/pay', () => {
    it('confirms payment on a RESERVED order and publishes the payment-confirmed event', async () => {
      const token = await registerAndLogin(ctx.app);
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;
      await ctx.app
        .get(OrdersService)
        .transitionOrder(id, OrderStatus.RESERVED);

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
      const published = new Promise<InventoryReservedEvent>((resolve) => {
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

      const response = await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as OrderResponseDTO;
      expect(body.status).toBe(OrderStatus.RESERVED);
      expect(body.paymentInitiatedAt).toBeDefined();
      expect((await published).orderId).toBe(id);
    });

    it('rejects a pay on a PENDING order (not yet RESERVED) with 409', async () => {
      const token = await registerAndLogin(ctx.app);
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('rejects a second pay on the same order with 409 (double-click guard)', async () => {
      const token = await registerAndLogin(ctx.app);
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;
      await ctx.app
        .get(OrdersService)
        .transitionOrder(id, OrderStatus.RESERVED);

      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it("returns 404 for another user's order", async () => {
      const ownerToken = await registerAndLogin(ctx.app, {
        email: 'pay-owner@example.com',
      });
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      const otherToken = await registerAndLogin(ctx.app, {
        email: 'pay-other@example.com',
      });
      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer())
        .post('/orders/00000000-0000-0000-0000-000000000000/pay')
        .expect(401);
    });
  });

  describe('order state machine (no arbitrary status mutation)', () => {
    it('exposes no HTTP route to set an order status directly', async () => {
      const token = await registerAndLogin(ctx.app);
      const created = await request(ctx.app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      // There is deliberately no status-mutation endpoint; these routes do not
      // exist, so the FSM cannot be bypassed over HTTP.
      await request(ctx.app.getHttpServer())
        .patch(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: OrderStatus.PAID })
        .expect(404);
      await request(ctx.app.getHttpServer())
        .put(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: OrderStatus.COMPLETED })
        .expect(404);
    });
  });
});
