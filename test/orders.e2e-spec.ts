import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import { registerAndLogin, startTestApp, stopTestApp } from '@test/support/e2e';

describe('OrdersController (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app, dataSource, container } = await startTestApp({
      entities: [UserEntity, RefreshTokenEntity, OrderEntity],
      imports: [AuthModule, OrdersModule],
    }));
  });

  afterAll(async () => {
    await stopTestApp({ app, dataSource, container });
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "orders", "refresh_tokens", "users" CASCADE',
    );
  });

  describe('POST /orders', () => {
    it('creates a PENDING order owned by the authenticated caller', async () => {
      const token = await registerAndLogin(app);

      const response = await request(app.getHttpServer())
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
      await request(app.getHttpServer()).post('/orders').expect(401);
    });
  });

  describe('GET /orders', () => {
    async function createOrder(token: string): Promise<void> {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    }

    it("returns only the caller's own orders, partitioned by user", async () => {
      const alice = await registerAndLogin(app, { email: 'alice@example.com' });
      const bob = await registerAndLogin(app, { email: 'bob@example.com' });
      await createOrder(alice);
      await createOrder(alice);
      await createOrder(bob);

      const aliceOrders = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${alice}`)
        .expect(200);
      const bobOrders = await request(app.getHttpServer())
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
      const token = await registerAndLogin(app);

      const response = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(app.getHttpServer()).get('/orders').expect(401);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns an order the caller owns', async () => {
      const token = await registerAndLogin(app);
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      const response = await request(app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as OrderResponseDTO).id).toBe(id);
    });

    it("returns 404 for another user's order (existence hidden)", async () => {
      const ownerToken = await registerAndLogin(app, {
        email: 'owner@example.com',
      });
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      const otherToken = await registerAndLogin(app, {
        email: 'other@example.com',
      });
      await request(app.getHttpServer())
        .get(`/orders/${id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns 404 for an unknown order id', async () => {
      const token = await registerAndLogin(app);

      await request(app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 400 for a malformed order id', async () => {
      const token = await registerAndLogin(app);

      await request(app.getHttpServer())
        .get('/orders/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(app.getHttpServer())
        .get('/orders/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });

  describe('order state machine (no arbitrary status mutation)', () => {
    it('exposes no HTTP route to set an order status directly', async () => {
      const token = await registerAndLogin(app);
      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { id } = created.body as OrderResponseDTO;

      // There is deliberately no status-mutation endpoint; these routes do not
      // exist, so the FSM cannot be bypassed over HTTP.
      await request(app.getHttpServer())
        .patch(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: OrderStatus.PAID })
        .expect(404);
      await request(app.getHttpServer())
        .put(`/orders/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: OrderStatus.COMPLETED })
        .expect(404);
    });
  });
});
