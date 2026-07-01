import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { AuthModule } from '@/modules/auth/auth.module';
import { ProductsModule } from '@/modules/products/products.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { CartController } from '@/modules/cart/cart.controller';
import { CartService } from '@/modules/cart/cart.service';

/**
 * The basket: add/remove line items, then the one-shot checkout that hands
 * off to OrdersService.createOrder. ProductsModule supplies product lookups;
 * OrdersModule supplies order creation.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CartEntity, CartItemEntity]),
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
