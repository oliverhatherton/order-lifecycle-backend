import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { PaymentModule } from '@/modules/payment/payment.module';
import { CompletionModule } from '@/modules/completion/completion.module';
import { EmailModule } from '@/modules/email/email.module';
import { CacheModule } from '@/modules/cache/cache.module';
import { MetricsModule } from '@/modules/metrics/metrics.module';
import databaseConfig from '@/config/database.config';
import jwtConfig from '@/config/jwt.config';
import rabbitmqConfig from '@/config/rabbitmq.config';
import redisConfig from '@/config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig, rabbitmqConfig, redisConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.get<TypeOrmModuleOptions>('database')!,
    }),
    CacheModule,
    MetricsModule,
    AuthModule,
    OrdersModule,
    InventoryModule,
    PaymentModule,
    CompletionModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
