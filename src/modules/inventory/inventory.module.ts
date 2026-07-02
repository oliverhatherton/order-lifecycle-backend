import { Module } from '@nestjs/common';
import { InventoryConsumer } from '@/modules/inventory/inventory.consumer';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { ProductsModule } from '@/modules/products/products.module';

/**
 * The inventory "service": consumes OrderCreated, reserves real stock and
 * advances the order to RESERVED (or FAILED if short). MessagingModule
 * supplies the broker + inbox + outbox; OrdersModule supplies the
 * transition; ProductsModule supplies stock reservation.
 */
@Module({
  imports: [MessagingModule, OrdersModule, ProductsModule],
  providers: [InventoryConsumer],
})
export class InventoryModule {}
