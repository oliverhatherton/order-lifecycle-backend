import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
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
  ) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: OrderRoutingKey.PaymentProcessed,
    queue: 'completion.payment_processed',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
  })
  async onPaymentProcessed(
    event: PaymentProcessedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    const messageId = amqpMsg.properties.messageId as string | undefined;
    if (!messageId) {
      this.logger.error(
        `PaymentProcessed for order ${event.orderId} has no messageId; dead-lettering`,
      );
      return new Nack(false);
    }

    const processed = await this.inbox.runOnce(
      messageId,
      CONSUMER,
      async (manager) => {
        await this.orders.transitionOrder(
          event.orderId,
          OrderStatus.COMPLETED,
          manager,
        );
      },
    );

    if (!processed) {
      this.logger.log(
        `Skipped already-processed PaymentProcessed for order ${event.orderId}`,
      );
      return;
    }

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
