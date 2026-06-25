import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from '@/modules/orders/controllers/orders.controller';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { AuthModule } from '@/modules/auth/auth.module';
import { MessagingModule } from '@/modules/messaging/messaging.module';

@Module({
  // AuthModule supplies JwtAuthGuard; MessagingModule supplies EventPublisher.
  imports: [
    TypeOrmModule.forFeature([OrderEntity]),
    AuthModule,
    MessagingModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  // Exported so consumer modules (e.g. InventoryModule) can drive transitions.
  exports: [OrdersService],
})
export class OrdersModule {}
