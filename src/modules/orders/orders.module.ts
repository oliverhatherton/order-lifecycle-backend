import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from '@/modules/orders/controllers/orders.controller';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { AuthModule } from '@/modules/auth/auth.module';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { ProductsModule } from '@/modules/products/products.module';

@Module({
  // AuthModule supplies JwtAuthGuard; MessagingModule supplies OutboxService;
  // ProductsModule supplies stock restore for cancelOrder.
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderItemEntity]),
    AuthModule,
    MessagingModule,
    ProductsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  // Exported so consumer modules (e.g. InventoryModule) can drive transitions.
  exports: [OrdersService],
})
export class OrdersModule {}
