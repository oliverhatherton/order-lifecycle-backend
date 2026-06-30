import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';
import { runWithCorrelationId } from '@/common/correlation/correlation';
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
    private readonly publisher: EventPublisher,
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
      return new Nack(false);
    }

    const result = await this.gateway.authorize(event);
    const targetStatus = result.authorized
      ? OrderStatus.PAID
      : OrderStatus.FAILED;

    const processed = await this.inbox.runOnce(
      messageId,
      CONSUMER,
      async (manager) => {
        await this.orders.transitionOrder(event.orderId, targetStatus, manager);
      },
    );
    if (!processed) {
      this.logger.log(
        `Skipped already-processed InventoryReserved for order ${event.orderId}`,
      );
      return;
    }

    if (result.authorized) {
      await this.publishPaid(event);
    } else {
      await this.publishFailed(
        event,
        result.declineReason ?? 'payment_declined',
      );
    }
  }

  private async publishPaid(event: InventoryReservedEvent): Promise<void> {
    const paid: PaymentProcessedEvent = {
      orderId: event.orderId,
      userId: event.userId,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.publisher.publish(OrderRoutingKey.PaymentProcessed, paid);
      this.logger.log(`Payment processed for order ${event.orderId}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish PaymentProcessed for order ${event.orderId}`,
        error as Error,
      );
    }
  }

  private async publishFailed(
    event: InventoryReservedEvent,
    reason: string,
  ): Promise<void> {
    const failed: OrderFailedEvent = {
      orderId: event.orderId,
      userId: event.userId,
      reason,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.publisher.publish(OrderRoutingKey.Failed, failed);
      this.logger.log(`Payment declined for order ${event.orderId}: ${reason}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish OrderFailed for order ${event.orderId}`,
        error as Error,
      );
    }
  }
}
