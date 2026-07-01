/** Topic exchange carrying the order lifecycle events, and its dead-letter pair. */
export const ORDER_EXCHANGE = 'order_lifecycle';
export const ORDER_DLX = 'order_lifecycle.dlx';
/** Single dead-letter queue that retains poison messages from every consumer. */
export const ORDER_DLQ = 'order_lifecycle.dlq';

/**
 * Routing keys for the order lifecycle events. Consumers bind their queues to
 * these keys on {@link ORDER_EXCHANGE}.
 */
export const OrderRoutingKey = {
  Created: 'order.created',
  InventoryReserved: 'order.inventory_reserved',
  PaymentProcessed: 'order.payment_processed',
  Completed: 'order.completed',
  Failed: 'order.failed',
} as const;

/** A line item, as carried on OrderCreatedEvent for InventoryConsumer to reserve. */
export interface OrderCreatedEventLine {
  productId: string;
  quantity: number;
}

/** Published when a new order has been created (and committed) in PENDING. */
export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  items: OrderCreatedEventLine[];
  /** ISO-8601 timestamp of when the order was created. */
  occurredAt: string;
}

/**
 * Published when the caller confirms payment on a RESERVED order (the
 * simulated "Pay" action — see OrdersService.initiatePayment). Named for the
 * inventory-reserved milestone it originally followed automatically; now it
 * doubles as the payment-confirmed signal PaymentConsumer waits for, since
 * inventory reservation itself no longer auto-publishes.
 */
export interface InventoryReservedEvent {
  orderId: string;
  userId: string;
  occurredAt: string;
}

/** Published when payment has succeeded for an order (now PAID). */
export interface PaymentProcessedEvent {
  orderId: string;
  userId: string;
  occurredAt: string;
}

/** Published when an order has been fully completed (now COMPLETED). */
export interface OrderCompletedEvent {
  orderId: string;
  userId: string;
  occurredAt: string;
}

/** Published when an order has failed (now FAILED). */
export interface OrderFailedEvent {
  orderId: string;
  userId: string;
  /** Short machine-readable reason, e.g. `payment_declined`. */
  reason: string;
  occurredAt: string;
}
