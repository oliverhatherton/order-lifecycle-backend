import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { AuthModule } from '@/modules/auth/auth.module';
import { ProductsController } from '@/modules/products/products.controller';
import { ProductsService } from '@/modules/products/products.service';
import { StockReplenishmentService } from '@/modules/products/stock-replenishment.service';

/**
 * Owns the product catalog: reservation/restore (used by InventoryConsumer
 * and OrdersService.cancelOrder), the read-only `/products` listing, and the
 * background low-stock top-up (StockReplenishmentService).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity]), AuthModule],
  controllers: [ProductsController],
  providers: [ProductsService, StockReplenishmentService],
  exports: [ProductsService],
})
export class ProductsModule {}
