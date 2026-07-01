import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import type { InventoryReservedEvent } from '@/modules/messaging/events/order-events';

/** Outcome of a payment authorisation attempt. */
export interface PaymentResult {
  authorized: boolean;
  /** Populated when `authorized` is false. */
  declineReason?: string;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Simulated payment gateway. Real payment processing is a non-goal, so this
 * stands in as the seam a real provider would slot into — but it is **idempotent
 * per order**: `authorize` keys on the order id (the idempotency key) and only
 * ever charges once, returning the stored decision on any repeat. This closes
 * the window where a consumer crash-then-redelivery would re-invoke `authorize`
 * (the inbox protects the DB transition, not the external charge).
 *
 * `charge` is the simulated provider decision (always authorises by default);
 * tests override the whole gateway, or spy on `charge`, to force a decline.
 */
@Injectable()
export class PaymentGateway {
  private readonly logger = new Logger(PaymentGateway.name);

  constructor(
    @InjectRepository(PaymentAuthorizationEntity)
    private readonly authorizations: Repository<PaymentAuthorizationEntity>,
  ) {}

  async authorize(event: InventoryReservedEvent): Promise<PaymentResult> {
    const existing = await this.authorizations.findOneBy({
      orderId: event.orderId,
    });
    if (existing) {
      this.logger.log(
        `Reusing stored authorization for order ${event.orderId} (idempotent)`,
      );
      return toResult(existing);
    }

    const result = await this.charge(event);

    try {
      await this.authorizations.insert({
        orderId: event.orderId,
        authorized: result.authorized,
        declineReason: result.declineReason ?? null,
      });
    } catch (error) {
      // A concurrent delivery won the race and stored first; return its decision
      // so two in-flight authorizations still resolve to a single charge.
      if (error instanceof QueryFailedError && isUniqueViolation(error)) {
        const stored = await this.authorizations.findOneBy({
          orderId: event.orderId,
        });
        if (stored) return toResult(stored);
      }
      throw error;
    }

    return result;
  }

  /** The simulated provider decision — the part that "costs money". */
  charge(_event: InventoryReservedEvent): Promise<PaymentResult> {
    return Promise.resolve({ authorized: true });
  }
}

function toResult(record: PaymentAuthorizationEntity): PaymentResult {
  return record.authorized
    ? { authorized: true }
    : { authorized: false, declineReason: record.declineReason ?? undefined };
}

function isUniqueViolation(error: QueryFailedError): boolean {
  return (error.driverError as { code?: string }).code === UNIQUE_VIOLATION;
}
