import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { OutboxRelayService } from '@/modules/messaging/outbox/outbox-relay.service';
import {
  ORDER_DLQ,
  ORDER_DLX,
  ORDER_EXCHANGE,
} from '@/modules/messaging/events/order-events';

/**
 * Owns the RabbitMQ connection and declares the lifecycle topology on boot: the
 * order topic exchange plus a dead-letter exchange for poison messages. Exposes
 * InboxService (consumer idempotency) and OutboxService (transactional publish)
 * to the feature modules, and re-exports RabbitMQModule so they can declare
 * @RabbitSubscribe consumers. EventPublisher and OutboxRelayService are
 * internal — nothing outside this module talks to the broker directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProcessedMessageEntity, OutboxMessageEntity]),
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('rabbitmq.uri'),
        exchanges: [
          { name: ORDER_EXCHANGE, type: 'topic' },
          { name: ORDER_DLX, type: 'topic' },
        ],
        // Single DLQ bound to the dead-letter exchange catches poison messages
        // from every consumer (see createRetryErrorHandler).
        queues: [
          {
            name: ORDER_DLQ,
            exchange: ORDER_DLX,
            routingKey: '#',
            createQueueIfNotExists: true,
            options: { durable: true },
          },
        ],
        connectionInitOptions: { wait: true, timeout: 20000 },
      }),
    }),
  ],
  providers: [EventPublisher, InboxService, OutboxService, OutboxRelayService],
  exports: [RabbitMQModule, InboxService, OutboxService],
})
export class MessagingModule {}
