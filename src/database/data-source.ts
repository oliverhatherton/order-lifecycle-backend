import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { migrations } from '@/database/migrations';

// Standalone DataSource for the TypeORM CLI (migration generate/run/revert).
// The running app configures TypeORM through Nest (src/config/database.config.ts);
// this file mirrors that connection so the CLI talks to the same database.
loadEnv();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'order_lifecycle',
  ssl:
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  entities: [
    UserEntity,
    RefreshTokenEntity,
    OrderEntity,
    ProcessedMessageEntity,
    PaymentAuthorizationEntity,
    MetricEventEntity,
    ProductEntity,
    CartEntity,
    CartItemEntity,
    OrderItemEntity,
  ],
  migrations,
  synchronize: false,
});

export default AppDataSource;
