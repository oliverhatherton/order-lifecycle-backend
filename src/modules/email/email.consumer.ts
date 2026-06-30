import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';
import { processEventOnce } from '@/modules/messaging/process-event-once';
import {
  ORDER_DLX,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  OrderCompletedEvent,
  OrderFailedEvent,
} from '@/modules/messaging/events/order-events';

const CONSUMER = 'email';

/** Sends (simulated) notifications when an order reaches a terminal state. */
@Injectable()
export class EmailConsumer {
  private readonly logger = new Logger(EmailConsumer.name);

  constructor(private readonly inbox: InboxService) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: [OrderRoutingKey.Completed, OrderRoutingKey.Failed],
    queue: 'email.notifications',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
    errorHandler: createRetryErrorHandler('email.notifications'),
  })
  async onTerminalEvent(
    event: OrderCompletedEvent | OrderFailedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    const failed = amqpMsg.fields.routingKey === OrderRoutingKey.Failed;

    // Inbox keeps the notification to once per message; the "send" is a log,
    // since real email delivery is out of scope for this epic.
    const outcome = await processEventOnce(
      amqpMsg,
      CONSUMER,
      this.inbox,
      this.logger,
      () => {
        const suffix = failed
          ? ` failed (${(event as OrderFailedEvent).reason})`
          : ' completed';
        this.logger.log(
          `Email to user ${event.userId}: order ${event.orderId}${suffix}`,
        );
        return Promise.resolve();
      },
    );
    if (outcome instanceof Nack) return outcome;
  }
}
