import { registerAs } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'order_lifecycle',
    autoLoadEntities: true,
    // Auto-sync in dev; in production it is off by default (no migrations yet)
    // unless DB_SYNCHRONIZE=true is set to create the schema on first deploy.
    synchronize:
      process.env.DB_SYNCHRONIZE === 'true' ||
      process.env.NODE_ENV !== 'production',
    // Managed Postgres (Neon, etc.) needs TLS; Render's internal DB does not.
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  }),
);
