import { OrderStatus } from '@/entities/order/OrderStatus';

/**
 * The order lifecycle as a finite state machine — the single source of truth
 * for which status transitions are legal. PENDING→RESERVED→PAID→COMPLETED is
 * the happy path; an order can fail from PENDING (inventory) or RESERVED
 * (payment), giving PENDING→FAILED and RESERVED→FAILED. The caller can also
 * cancel from PENDING or RESERVED (never PAID or later — that would need a
 * refund flow, which is out of scope); cancelling a RESERVED order that has
 * already had payment confirmed is additionally blocked in
 * OrdersService.cancelOrder (a `paymentInitiatedAt` check the FSM itself
 * doesn't know about). COMPLETED, FAILED and CANCELLED are terminal (no
 * outgoing transitions). Every other pair, including self-transitions and
 * backwards moves, is illegal.
 */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.PENDING]: [
    OrderStatus.RESERVED,
    OrderStatus.FAILED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.RESERVED]: [
    OrderStatus.PAID,
    OrderStatus.FAILED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAID]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.FAILED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** True when moving an order directly from `from` to `to` is a legal transition. */
export function isTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** True when `status` has no outgoing transitions — the order will never change again. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}
