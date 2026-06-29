import { Module } from '@nestjs/common';
import { OrderCompletionConsumer } from '@/modules/completion/order-completion.consumer';
import { MessagingModule } from '@/modules/messaging/messaging.module';
import { OrdersModule } from '@/modules/orders/orders.module';

/**
 * Finalisation stage: consumes PaymentProcessed and advances the order to
 * COMPLETED, emitting OrderCompleted. Kept separate from OrdersModule so the
 * upstream stages can be tested without auto-completing the order.
 */
@Module({
  imports: [MessagingModule, OrdersModule],
  providers: [OrderCompletionConsumer],
})
export class CompletionModule {}
