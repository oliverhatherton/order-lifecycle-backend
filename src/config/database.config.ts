import { registerAs } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { migrations } from '@/database/migrations';

export default registerAs('database', (): TypeOrmModuleOptions => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'order_lifecycle',
    autoLoadEntities: true,
    // Dev auto-syncs the schema for fast iteration; production never does —
    // it applies versioned migrations instead (run on boot below).
    synchronize: !isProduction,
    migrations,
    migrationsRun: isProduction,
    // Managed Postgres (Neon, etc.) needs TLS; Render's internal DB does not.
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
});
