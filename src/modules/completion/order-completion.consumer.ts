import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';
import { processEventOnce } from '@/modules/messaging/process-event-once';
import { runWithCorrelationId } from '@/common/correlation/correlation';
import { OrdersService } from '@/modules/orders/services/orders.service';
import {
  ORDER_DLX,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  OrderCompletedEvent,
  PaymentProcessedEvent,
} from '@/modules/messaging/events/order-events';

const CONSUMER = 'completion';

/** Finalises a paid order: PAID → COMPLETED, then announces OrderCompleted. */
@Injectable()
export class OrderCompletionConsumer {
  private readonly logger = new Logger(OrderCompletionConsumer.name);

  constructor(
    private readonly inbox: InboxService,
    private readonly orders: OrdersService,
    private readonly publisher: EventPublisher,
    private readonly cls: ClsService,
  ) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: OrderRoutingKey.PaymentProcessed,
    queue: 'completion.payment_processed',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
    errorHandler: createRetryErrorHandler('completion.payment_processed'),
  })
  onPaymentProcessed(
    event: PaymentProcessedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    // Continue the upstream correlation id across completion + OrderCompleted.
    return runWithCorrelationId(this.cls, amqpMsg, () =>
      this.complete(event, amqpMsg),
    );
  }

  private async complete(
    event: PaymentProcessedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    const outcome = await processEventOnce(
      amqpMsg,
      CONSUMER,
      this.inbox,
      this.logger,
      async (manager) => {
        await this.orders.transitionOrder(
          event.orderId,
          OrderStatus.COMPLETED,
          manager,
        );
      },
    );
    if (outcome instanceof Nack) return outcome;
    if (outcome === 'skipped') return;

    const completed: OrderCompletedEvent = {
      orderId: event.orderId,
      userId: event.userId,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.publisher.publish(OrderRoutingKey.Completed, completed);
      this.logger.log(`Order ${event.orderId} completed`);
    } catch (error) {
      this.logger.error(
        `Failed to publish OrderCompleted for order ${event.orderId}`,
        error as Error,
      );
    }
  }
}
