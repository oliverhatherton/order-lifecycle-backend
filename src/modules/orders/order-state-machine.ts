import { OrderStatus } from '@/entities/order/OrderStatus';

/**
 * The order lifecycle as a finite state machine — the single source of truth
 * for which status transitions are legal. PENDING→RESERVED→PAID→COMPLETED is
 * the happy path; an order can fail from PENDING (inventory) or RESERVED
 * (payment), giving PENDING→FAILED and RESERVED→FAILED. COMPLETED and FAILED
 * are terminal (no outgoing transitions). Every other pair, including
 * self-transitions and backwards moves, is illegal.
 */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.PENDING]: [OrderStatus.RESERVED, OrderStatus.FAILED],
  [OrderStatus.RESERVED]: [OrderStatus.PAID, OrderStatus.FAILED],
  [OrderStatus.PAID]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.FAILED]: [],
};

/** True when moving an order directly from `from` to `to` is a legal transition. */
export function isTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
