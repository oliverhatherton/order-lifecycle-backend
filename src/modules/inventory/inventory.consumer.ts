import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { createRetryErrorHandler } from '@/modules/messaging/retry-error-handler';
import { OrdersService } from '@/modules/orders/services/orders.service';
import {
  ORDER_DLX,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  InventoryReservedEvent,
  OrderCreatedEvent,
} from '@/modules/messaging/events/order-events';

/** Inbox consumer key — scopes idempotency records to this consumer. */
const CONSUMER = 'inventory';

/** Reserves inventory in response to OrderCreated and advances the order. */
@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    private readonly inbox: InboxService,
    private readonly orders: OrdersService,
    private readonly publisher: EventPublisher,
  ) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: OrderRoutingKey.Created,
    queue: 'inventory.order_created',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
    errorHandler: createRetryErrorHandler('inventory.order_created'),
  })
  async onOrderCreated(
    event: OrderCreatedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    const messageId = amqpMsg.properties.messageId as string | undefined;
    if (!messageId) {
      this.logger.error(
        `OrderCreated for order ${event.orderId} has no messageId; dead-lettering`,
      );
      return new Nack(false);
    }

    // Reserve inventory (simulated) and advance the order to RESERVED exactly
    // once: the transition and the inbox record commit in one transaction.
    const processed = await this.inbox.runOnce(
      messageId,
      CONSUMER,
      async (manager) => {
        await this.orders.transitionOrder(
          event.orderId,
          OrderStatus.RESERVED,
          manager,
        );
      },
    );

    if (!processed) {
      this.logger.log(
        `Skipped already-processed OrderCreated for order ${event.orderId}`,
      );
      return;
    }

    const reserved: InventoryReservedEvent = {
      orderId: event.orderId,
      userId: event.userId,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.publisher.publish(OrderRoutingKey.InventoryReserved, reserved);
      this.logger.log(`Reserved inventory for order ${event.orderId}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish InventoryReserved for order ${event.orderId}`,
        error as Error,
      );
    }
  }
}
