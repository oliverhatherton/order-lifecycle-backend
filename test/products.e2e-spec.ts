import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { ProductsModule } from '@/modules/products/products.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { ProductResponseDTO } from '@/modules/products/dto/ProductResponseDTO';
import { createProduct, registerAndLogin, setupE2eTest } from '@test/support/e2e';

describe('Products (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [UserEntity, RefreshTokenEntity, ProductEntity],
    imports: [AuthModule, ProductsModule],
    truncate: ['products', 'refresh_tokens', 'users'],
  });

  it('lists the catalog for an authenticated caller', async () => {
    const token = await registerAndLogin(ctx.app);
    await createProduct(ctx.dataSource, { name: 'Zeta Widget', stock: 5 });
    await createProduct(ctx.dataSource, { name: 'Alpha Widget', stock: 10 });

    const response = await request(ctx.app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ProductResponseDTO[];
    expect(body).toHaveLength(2);
    // Alphabetical.
    expect(body.map((p) => p.name)).toEqual(['Alpha Widget', 'Zeta Widget']);
  });

  it('rejects an anonymous request with 401', async () => {
    await request(ctx.app.getHttpServer()).get('/products').expect(401);
  });
});
