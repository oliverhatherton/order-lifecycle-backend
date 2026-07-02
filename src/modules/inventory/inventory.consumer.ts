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
  InsufficientStockError,
  ProductsService,
} from '@/modules/products/products.service';
import {
  ORDER_DLX,
  ORDER_EXCHANGE,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';
import type {
  OrderCreatedEvent,
  OrderFailedEvent,
} from '@/modules/messaging/events/order-events';

/** Inbox consumer key — scopes idempotency records to this consumer. */
const CONSUMER = 'inventory';

/**
 * Reserves real stock in response to OrderCreated: atomically decrements
 * each line item's product (ProductsService.reserveStock) and advances the
 * order to RESERVED. If any line is short, the order goes to FAILED instead
 * (reason `insufficient_stock`) and any stock already decremented for this
 * order is put back — see ProductsService.reserveStock for how.
 *
 * On success, deliberately does **not** publish onward from RESERVED — the
 * order pauses there until the caller confirms payment via
 * `POST /orders/{id}/pay` (OrdersService.initiatePayment), which enqueues
 * the event PaymentConsumer listens for. This turns "reserved" into a real
 * gate the UI's simulated "Pay" button controls, instead of the whole chain
 * firing automatically.
 */
@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    private readonly inbox: InboxService,
    private readonly orders: OrdersService,
    private readonly products: ProductsService,
    private readonly outbox: OutboxService,
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
    // Continue the publisher's correlation id for this whole handler so its
    // logs stay on the same trace as the request that created the order.
    return runWithCorrelationId(this.cls, amqpMsg, () =>
      this.reserve(event, amqpMsg),
    );
  }

  private async reserve(
    event: OrderCreatedEvent,
    amqpMsg: ConsumeMessage,
  ): Promise<Nack | void> {
    let shortProductId: string | undefined;

    // Reserve stock and advance the order exactly once: everything —
    // including the OrderFailed outbox row on the insufficient-stock path —
    // commits (or the whole message is retried) in one transaction with the
    // inbox record. An insufficient-stock failure is handled *inside* this
    // callback — the FAILED transition still needs to commit — rather than
    // by letting the transaction fail outright.
    const outcome = await processEventOnce(
      amqpMsg,
      CONSUMER,
      this.inbox,
      this.logger,
      async (manager) => {
        try {
          await this.products.reserveStock(event.items, manager);
          await this.orders.transitionOrder(
            event.orderId,
            OrderStatus.RESERVED,
            manager,
          );
        } catch (error) {
          if (!(error instanceof InsufficientStockError)) throw error;
          shortProductId = error.productId;
          await this.orders.transitionOrder(
            event.orderId,
            OrderStatus.FAILED,
            manager,
          );
          const failed: OrderFailedEvent = {
            orderId: event.orderId,
            userId: event.userId,
            reason: 'insufficient_stock',
            occurredAt: new Date().toISOString(),
          };
          await this.outbox.enqueue(manager, OrderRoutingKey.Failed, failed);
        }
      },
    );
    if (outcome instanceof Nack) return outcome;
    if (outcome === 'skipped') return;

    if (shortProductId) {
      this.logger.log(
        `Order ${event.orderId} failed: insufficient stock for product ${shortProductId}`,
      );
      return;
    }

    this.logger.log(
      `Reserved inventory for order ${event.orderId}; awaiting payment confirmation`,
    );
  }
}
