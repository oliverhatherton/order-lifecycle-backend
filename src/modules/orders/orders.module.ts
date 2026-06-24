import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from '@/modules/orders/controllers/orders.controller';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { AuthModule } from '@/modules/auth/auth.module';

@Module({
  // AuthModule supplies JwtAuthGuard (and the JwtService it depends on).
  imports: [TypeOrmModule.forFeature([OrderEntity]), AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
