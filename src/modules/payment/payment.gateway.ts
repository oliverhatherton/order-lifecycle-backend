import { Injectable } from '@nestjs/common';
import type { InventoryReservedEvent } from '@/modules/messaging/events/order-events';

/** Outcome of a payment authorisation attempt. */
export interface PaymentResult {
  authorized: boolean;
  /** Populated when `authorized` is false. */
  declineReason?: string;
}

/**
 * Simulated payment gateway — Epic 3's non-goal is real payment processing, so
 * this stands in as the seam a real provider would slot into. The default
 * always authorises; tests override this provider to force a decline and
 * exercise the failure path.
 */
@Injectable()
export class PaymentGateway {
  authorize(_event: InventoryReservedEvent): Promise<PaymentResult> {
    return Promise.resolve({ authorized: true });
  }
}
