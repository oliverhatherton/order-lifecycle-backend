/**
 * Topic-exchange routing keys for the order lifecycle events. Consumers bind
 * their queues to these keys on the `rabbitmq.exchange` exchange.
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
