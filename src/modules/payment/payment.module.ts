import { Module } from '@nestjs/common';
import { PaymentConsumer } from '@/modules/payment/payment.consumer';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { OrdersModule } from '@/modules/orders/orders.module';

/**
 * The payment "service": consumes InventoryReserved, authorises payment and
 * advances the order to PAID, or to FAILED on a decline.
 */
@Module({
  imports: [MessagingModule, OrdersModule],
  providers: [PaymentConsumer, PaymentGateway],
})
export class PaymentModule {}
