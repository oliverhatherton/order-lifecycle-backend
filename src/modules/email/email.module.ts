import { Module } from '@nestjs/common';
import { EmailConsumer } from '@/modules/email/email.consumer';
import { MessagingModule } from '@/modules/messaging/messaging.module';

/**
 * The email "service": reacts to terminal order events (OrderCompleted /
 * OrderFailed) with a simulated notification. Idempotent via the inbox.
 */
@Module({
  imports: [MessagingModule],
  providers: [EmailConsumer],
})
export class EmailModule {}
