/** Topic exchange carrying the order lifecycle events, and its dead-letter pair. */
export const ORDER_EXCHANGE = 'order_lifecycle';
export const ORDER_DLX = 'order_lifecycle.dlx';

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

/** Published when a new order has been created (and committed) in PENDING. */
export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  /** ISO-8601 timestamp of when the order was created. */
  occurredAt: string;
}

/** Published when inventory has been reserved for an order (now RESERVED). */
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
