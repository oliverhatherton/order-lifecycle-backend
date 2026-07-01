import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { ProductsModule } from '@/modules/products/products.module';
import { CartModule } from '@/modules/cart/cart.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { CartResponseDTO } from '@/modules/cart/dto/CartResponseDTO';
import { OrderResponseDTO } from '@/modules/orders/dto/OrderResponseDTO';
import { createProduct, registerAndLogin, setupE2eTest } from '@test/support/e2e';

describe('Cart (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [
      UserEntity,
      RefreshTokenEntity,
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      CartEntity,
      CartItemEntity,
    ],
    imports: [AuthModule, OrdersModule, ProductsModule, CartModule],
    truncate: [
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

  describe('GET /cart', () => {
    it('lazily creates an empty cart for a caller with none yet', async () => {
      const token = await registerAndLogin(ctx.app);

      const response = await request(ctx.app.getHttpServer())
        .get('/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as CartResponseDTO).items).toEqual([]);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer()).get('/cart').expect(401);
    });
  });

  describe('POST /cart/items', () => {
    it('adds a product to the cart, joined with its name and stock', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource, {
        name: 'Widget',
        stock: 20,
      });

      const response = await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 3 })
        .expect(200);

      const body = response.body as CartResponseDTO;
      expect(body.items).toEqual([
        {
          productId,
          productName: 'Widget',
          productStock: 20,
          quantity: 3,
        },
      ]);
    });

    it('sets (not adds to) the quantity on a repeated call for the same product', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);

      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 2 })
        .expect(200);
      const response = await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 5 })
        .expect(200);

      const body = response.body as CartResponseDTO;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].quantity).toBe(5);
    });

    it('404s for a product that does not exist', async () => {
      const token = await registerAndLogin(ctx.app);

      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 })
        .expect(404);
    });

    it('400s for a non-positive quantity', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);

      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 0 })
        .expect(400);
    });
  });

  describe('DELETE /cart/items/:productId', () => {
    it('removes a line item from the cart', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(200);

      const response = await request(ctx.app.getHttpServer())
        .delete(`/cart/items/${productId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as CartResponseDTO).items).toEqual([]);
    });
  });

  describe('POST /cart/checkout', () => {
    it('creates the order from the cart line items', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource, {
        name: 'Widget',
      });
      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 2 })
        .expect(200);

      const response = await request(ctx.app.getHttpServer())
        .post('/cart/checkout')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const order = response.body as OrderResponseDTO;
      expect(order.status).toBe('PENDING');
      expect(order.items).toEqual([
        expect.objectContaining({ productId, productName: 'Widget', quantity: 2 }),
      ]);
    });

    it('rejects checking out an empty cart with 409', async () => {
      const token = await registerAndLogin(ctx.app);

      await request(ctx.app.getHttpServer())
        .post('/cart/checkout')
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('can only ever be checked out once — a second checkout gets 409, even for the same cart', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(200);

      await request(ctx.app.getHttpServer())
        .post('/cart/checkout')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // GET /cart now lazily starts a *new* open cart (the checked-out one
      // is permanently closed) — checking out again with nothing added
      // hits the empty-cart guard, proving the old cart can't be reused.
      await request(ctx.app.getHttpServer())
        .post('/cart/checkout')
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('concurrent double-checkout only creates one order (double-click guard)', async () => {
      const token = await registerAndLogin(ctx.app);
      const productId = await createProduct(ctx.dataSource);
      await request(ctx.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId, quantity: 1 })
        .expect(200);

      const [first, second] = await Promise.all([
        request(ctx.app.getHttpServer())
          .post('/cart/checkout')
          .set('Authorization', `Bearer ${token}`),
        request(ctx.app.getHttpServer())
          .post('/cart/checkout')
          .set('Authorization', `Bearer ${token}`),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const orders = await request(ctx.app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((orders.body as OrderResponseDTO[])).toHaveLength(1);
    });

    it('rejects an anonymous request with 401', async () => {
      await request(ctx.app.getHttpServer()).post('/cart/checkout').expect(401);
    });
  });
});
