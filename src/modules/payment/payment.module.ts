import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentConsumer } from '@/modules/payment/payment.consumer';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { OrdersModule } from '@/modules/orders/orders.module';

/**
 * The payment "service": consumes InventoryReserved, authorises payment
 * (idempotently, keyed by order id) and advances the order to PAID, or to
 * FAILED on a decline.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentAuthorizationEntity]),
    MessagingModule,
    OrdersModule,
  ],
  providers: [PaymentConsumer, PaymentGateway],
})
export class PaymentModule {}
