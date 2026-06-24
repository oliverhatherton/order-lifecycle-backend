import {
  ORDER_TRANSITIONS,
  isTransitionAllowed,
} from '@/modules/orders/order-state-machine';
import { OrderStatus } from '@/entities/order/OrderStatus';

describe('order state machine', () => {
  // The authoritative transition table, declared independently of the
  // implementation so the test pins the intended behaviour.
  const expectedAllowed: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.RESERVED, OrderStatus.FAILED],
    [OrderStatus.RESERVED]: [OrderStatus.PAID],
    [OrderStatus.PAID]: [OrderStatus.COMPLETED],
    [OrderStatus.COMPLETED]: [],
    [OrderStatus.FAILED]: [],
  };

  const allStatuses = Object.values(OrderStatus);

  // Exhaustive: assert every from×to pair in the full matrix (incl. self and
  // backwards transitions) matches the authoritative table.
  describe('isTransitionAllowed (full transition matrix)', () => {
    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const allowed = expectedAllowed[from].includes(to);
        it(`${allowed ? 'allows' : 'rejects'} ${from} -> ${to}`, () => {
          expect(isTransitionAllowed(from, to)).toBe(allowed);
        });
      }
    }
  });

  it('treats COMPLETED and FAILED as terminal (no outgoing transitions)', () => {
    expect(ORDER_TRANSITIONS[OrderStatus.COMPLETED]).toHaveLength(0);
    expect(ORDER_TRANSITIONS[OrderStatus.FAILED]).toHaveLength(0);
  });

  it('rejects every self-transition', () => {
    for (const status of allStatuses) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });
});
