import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
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
    private readonly outbox: OutboxService,
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
        const completed: OrderCompletedEvent = {
          orderId: event.orderId,
          userId: event.userId,
          occurredAt: new Date().toISOString(),
        };
        await this.outbox.enqueue(
          manager,
          OrderRoutingKey.Completed,
          completed,
        );
      },
    );
    if (outcome instanceof Nack) return outcome;
    if (outcome === 'skipped') return;

    this.logger.log(`Order ${event.orderId} completed`);
  }
}
