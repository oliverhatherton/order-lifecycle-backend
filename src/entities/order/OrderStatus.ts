/**
 * The lifecycle states of an order. Allowed transitions (see
 * order-state-machine.ts): PENDING→RESERVED→PAID→COMPLETED,
 * PENDING/RESERVED→FAILED, and PENDING/RESERVED→CANCELLED (the caller can
 * only cancel before payment is confirmed). COMPLETED, FAILED and CANCELLED
 * are terminal.
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  RESERVED = 'RESERVED',
  PAID = 'PAID',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
