import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
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
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import {
  InventoryReservedEvent,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import {
  createOrderViaCart,
  createProduct,
  registerAndLogin,
  setupE2eTest,
} from '@test/support/e2e';

describe('OrdersController (e2e)', () => {
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
      OutboxMessageEntity,
    ],
    imports: [AuthModule, OrdersModule, ProductsModule, CartModule],
    truncate: [
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
  });

  describe('GET /orders', () => {
    async function createOrder(token: string): Promise<void> {
      const productId = await createProduct(ctx.dataSource);
      await createOrderViaCart(ctx.app, token, productId);
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
    it('returns an order the caller owns, with its line items', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource, {
        name: 'Widget',
      });
      const { id } = await createOrderViaCart(ctx.app, token, productId, 3);

      const response = await request(ctx.app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as OrderResponseDTO;
      expect(body.id).toBe(id);
      expect(body.items).toEqual([
        expect.objectContaining({
          productId,
          productName: 'Widget',
          quantity: 3,
        }),
      ]);
    });

    it("returns 404 for another user's order (existence hidden)", async () => {
      const ownerToken = await registerAndLogin(ctx.app, {
        email: 'owner@example.com',
      });
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, ownerToken, productId);

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
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);
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
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);

      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('rejects a second pay on the same order with 409 (double-click guard)', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);
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
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, ownerToken, productId);

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

  describe('POST /orders/:id/cancel', () => {
    it('cancels a PENDING order', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);

      const response = await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as OrderResponseDTO).status).toBe(
        OrderStatus.CANCELLED,
      );
    });

    it('cancels a RESERVED order (before payment) and restores its stock', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource, { stock: 10 });
      const { id } = await createOrderViaCart(ctx.app, token, productId, 4);
      await ctx.app
        .get(OrdersService)
        .transitionOrder(id, OrderStatus.RESERVED);
      // Simulate the reservation's decrement, same as InventoryConsumer would.
      await ctx.dataSource.query(
        `UPDATE "products" SET stock = stock - 4 WHERE id = $1`,
        [productId],
      );

      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const product = await ctx.dataSource
        .getRepository(ProductEntity)
        .findOneByOrFail({ id: productId });
      expect(product.stock).toBe(10);
    });

    it('rejects cancelling once payment has been initiated', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);
      await ctx.app
        .get(OrdersService)
        .transitionOrder(id, OrderStatus.RESERVED);
      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it("returns 404 for another user's order", async () => {
      const ownerToken = await registerAndLogin(ctx.app, {
        email: 'cancel-owner@example.com',
      });
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, ownerToken, productId);

      const otherToken = await registerAndLogin(ctx.app, {
        email: 'cancel-other@example.com',
      });
      await request(ctx.app.getHttpServer())
        .post(`/orders/${id}/cancel`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer())
        .post('/orders/00000000-0000-0000-0000-000000000000/cancel')
        .expect(401);
    });
  });

  describe('order state machine (no arbitrary status mutation)', () => {
    it('exposes no HTTP route to set an order status directly', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      const { id } = await createOrderViaCart(ctx.app, token, productId);

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
