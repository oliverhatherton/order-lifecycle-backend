import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import type { InventoryReservedEvent } from '@/modules/messaging/events/order-events';
import { recordPaymentOutcome } from '@/modules/metrics/metrics.collectors';

/** Outcome of a payment authorisation attempt. */
export interface PaymentResult {
  authorized: boolean;
  /** Populated when `authorized` is false. */
  declineReason?: string;
}

/**
 * How long an undecided claim may sit before another delivery assumes its
 * owner crashed mid-charge and takes over. Comfortably longer than one
 * provider call, and longer than the whole retry backoff (1s+2s+4s), so a
 * concurrent duplicate retries until the owner finishes rather than taking
 * over a live claim.
 */
const STALE_CLAIM_SECONDS = 30;

/**
 * Thrown when another delivery holds a live claim on this order's charge.
 * Not a failure — the consumer's retry handler backs off and re-asks, by
 * which point the decision is normally recorded.
 */
export class PaymentInFlightError extends Error {
  constructor(public readonly orderId: string) {
    super(`Payment for order ${orderId} is already in flight`);
  }
}

/**
 * Simulated payment gateway. Real payment processing is a non-goal, so this
 * stands in as the seam a real provider would slot into — but it is
 * **idempotent per order**, with the order id as the idempotency key.
 *
 * The ledger row is claimed *before* the provider is called, not after:
 *
 * 1. `INSERT … ON CONFLICT DO NOTHING` with `authorized = NULL` (undecided).
 *    Exactly one delivery wins the insert and owns the charge.
 * 2. The owner calls `charge` with the idempotency key, then records the
 *    decision on its claimed row.
 * 3. A delivery that loses the insert returns the stored decision if there
 *    is one; if the claim is still undecided and live it throws
 *    PaymentInFlightError (retry with backoff); if the claim is stale — its
 *    owner crashed between claiming and recording — it re-calls `charge`
 *    with the **same** idempotency key and records the result.
 *
 * Step 3's takeover is what makes a crash mid-charge safe, and it relies on
 * the provider contract every real PSP offers (Stripe / Adyen / Braintree
 * `Idempotency-Key`): a repeated request with the same key returns the
 * original outcome instead of charging again. Without that contract no
 * client-side scheme can rule out a double charge after a crash, because the
 * client can't know whether the provider acted on the lost request.
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
    const { orderId } = event;

    if (!(await this.claim(orderId))) {
      const existing = await this.authorizations.findOneBy({ orderId });
      if (existing && existing.authorized !== null) {
        this.logger.log(
          `Reusing stored authorization for order ${orderId} (idempotent)`,
        );
        recordPaymentOutcome('deduplicated');
        return toResult(existing);
      }
      if (!(await this.isClaimStale(orderId))) {
        recordPaymentOutcome('in_flight');
        throw new PaymentInFlightError(orderId);
      }
      recordPaymentOutcome('takeover');
      this.logger.warn(
        `Taking over stale payment claim for order ${orderId}; re-calling provider with the same idempotency key`,
      );
    }

    const result = await this.charge(event, orderId);
    recordPaymentOutcome(result.authorized ? 'authorized' : 'declined');
    await this.authorizations.update(
      { orderId, authorized: IsNull() },
      {
        authorized: result.authorized,
        declineReason: result.declineReason ?? null,
      },
    );
    return result;
  }

  /**
   * The simulated provider decision — the part that "costs money". A real
   * implementation sends `idempotencyKey` as the provider's Idempotency-Key
   * header, so a repeat with the same key is answered, not re-charged.
   */
  charge(
    _event: InventoryReservedEvent,
    _idempotencyKey: string,
  ): Promise<PaymentResult> {
    return Promise.resolve({ authorized: true });
  }

  /** True if this call inserted the (undecided) ledger row and owns the charge. */
  private async claim(orderId: string): Promise<boolean> {
    const inserted: unknown[] = await this.authorizations.query(
      `INSERT INTO "payment_authorizations" ("orderId", "authorized")
       VALUES ($1, NULL)
       ON CONFLICT ("orderId") DO NOTHING
       RETURNING "orderId"`,
      [orderId],
    );
    return inserted.length > 0;
  }

  /** Staleness is judged by the DB clock, the same one that stamped createdAt. */
  private async isClaimStale(orderId: string): Promise<boolean> {
    const rows: Array<{ stale: boolean }> = await this.authorizations.query(
      `SELECT ("createdAt" < now()::timestamp - make_interval(secs => $2)) AS stale
       FROM "payment_authorizations"
       WHERE "orderId" = $1 AND "authorized" IS NULL`,
      [orderId, STALE_CLAIM_SECONDS],
    );
    return rows[0]?.stale === true;
  }
}

function toResult(record: PaymentAuthorizationEntity): PaymentResult {
  return record.authorized
    ? { authorized: true }
    : { authorized: false, declineReason: record.declineReason ?? undefined };
}
