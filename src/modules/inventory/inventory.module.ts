import { Module } from '@nestjs/common';
import { InventoryConsumer } from '@/modules/inventory/inventory.consumer';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { OrdersModule } from '@/modules/orders/orders.module';

/**
 * The inventory "service": consumes OrderCreated, reserves inventory and
 * advances the order to RESERVED. MessagingModule supplies the broker +
 * inbox + publisher; OrdersModule supplies the transition.
 */
@Module({
  imports: [MessagingModule, OrdersModule],
  providers: [InventoryConsumer],
})
export class InventoryModule {}
