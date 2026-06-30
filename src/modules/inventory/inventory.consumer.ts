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
    private readonly cls: ClsService,
  ) {}

  @RabbitSubscribe({
    exchange: ORDER_EXCHANGE,
    routingKey: OrderRoutingKey.Created,
    queue: 'inventory.order_created',
    queueOptions: { durable: true, deadLetterExchange: ORDER_DLX },
    errorHandler: createRetryErrorHandler('inventory.order_created'),
  })
  onOrderCreated(
    event: OrderCreatedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    // Continue the publisher's correlation id for this whole handler so its logs
    // and the InventoryReserved it emits stay on the same trace.
    return runWithCorrelationId(this.cls, amqpMsg, () =>
      this.reserve(event, amqpMsg),
    );
  }

  private async reserve(
    event: OrderCreatedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    // Reserve inventory (simulated) and advance the order to RESERVED exactly
    // once: the transition and the inbox record commit in one transaction.
    const outcome = await processEventOnce(
      amqpMsg,
      CONSUMER,
      this.inbox,
      this.logger,
      async (manager) => {
        await this.orders.transitionOrder(
          event.orderId,
          OrderStatus.RESERVED,
          manager,
        );
      },
    );
    if (outcome instanceof Nack) return outcome;
    if (outcome === 'skipped') return;

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
