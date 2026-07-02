import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { OutboxService } from '@/modules/messaging/outbox/outbox.service';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';
import { runWithCorrelationId } from '@/common/correlation/correlation';
import {
  recordConsumerOutcome,
  startConsumerTimer,
} from '@/modules/metrics/metrics.collectors';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import {
  ORDER_DLX,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  InventoryReservedEvent,
  OrderFailedEvent,
  PaymentProcessedEvent,
} from '@/modules/messaging/events/order-events';

const CONSUMER = 'payment';

/** Processes payment in response to InventoryReserved, advancing the order. */
@Injectable()
export class PaymentConsumer {
  private readonly logger = new Logger(PaymentConsumer.name);

  constructor(
    private readonly inbox: InboxService,
    private readonly orders: OrdersService,
    private readonly outbox: OutboxService,
    private readonly gateway: PaymentGateway,
    private readonly cls: ClsService,
  ) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: OrderRoutingKey.InventoryReserved,
    queue: 'payment.inventory_reserved',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
    errorHandler: createRetryErrorHandler('payment.inventory_reserved'),
  })
  onInventoryReserved(
    event: InventoryReservedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    // Continue the upstream correlation id across this handler and anything it
    // publishes (PaymentProcessed / OrderFailed).
    return runWithCorrelationId(this.cls, amqpMsg, () =>
      this.authorizeAndAdvance(event, amqpMsg),
    );
  }

  private async authorizeAndAdvance(
    event: InventoryReservedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    // Payment validates the messageId up front (rather than via processEventOnce
    // like the other consumers) because it authorises *before* the inbox
    // transaction — so the external call is never made for a bad or
    // already-handled message and never holds the DB transaction open.
    const messageId = amqpMsg.properties.messageId as string | undefined;
    if (!messageId) {
      this.logger.error(
        `InventoryReserved for order ${event.orderId} has no messageId; dead-lettering`,
      );
      recordConsumerOutcome(CONSUMER, 'failed');
      return new Nack(false);
    }

    const stopTimer = startConsumerTimer(CONSUMER);
    try {
      const result = await this.gateway.authorize(event);
      const targetStatus = result.authorized
        ? OrderStatus.PAID
        : OrderStatus.FAILED;
      const declineReason = result.declineReason ?? 'payment_declined';

      // The transition and its outbox row commit together — a redelivery
      // that lost the inbox race can't leave a status change without its
      // announcing event, or vice versa.
      const processed = await this.inbox.runOnce(
        messageId,
        CONSUMER,
        async (manager) => {
          await this.orders.transitionOrder(
            event.orderId,
            targetStatus,
            manager,
          );
          if (result.authorized) {
            const paid: PaymentProcessedEvent = {
              orderId: event.orderId,
              userId: event.userId,
              occurredAt: new Date().toISOString(),
            };
            await this.outbox.enqueue(
              manager,
              OrderRoutingKey.PaymentProcessed,
              paid,
            );
          } else {
            const failed: OrderFailedEvent = {
              orderId: event.orderId,
              userId: event.userId,
              reason: declineReason,
              occurredAt: new Date().toISOString(),
            };
            await this.outbox.enqueue(manager, OrderRoutingKey.Failed, failed);
          }
        },
      );
      if (!processed) {
        this.logger.log(
          `Skipped already-processed InventoryReserved for order ${event.orderId}`,
        );
        recordConsumerOutcome(CONSUMER, 'skipped');
        return;
      }

      recordConsumerOutcome(CONSUMER, 'processed');
      this.logger.log(
        result.authorized
          ? `Payment processed for order ${event.orderId}`
          : `Payment declined for order ${event.orderId}: ${declineReason}`,
      );
    } finally {
      stopTimer();
    }
  }
}
