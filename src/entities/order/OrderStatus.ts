/**
 * The lifecycle states of an order. Allowed transitions (enforced by the FSM in
 * Story 2.2): PENDING→RESERVED→PAID→COMPLETED, and PENDING→FAILED. COMPLETED
 * and FAILED are terminal.
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  RESERVED = 'RESERVED',
  PAID = 'PAID',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
