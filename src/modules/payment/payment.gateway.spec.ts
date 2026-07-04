import { IsNull, Repository } from 'typeorm';
import {
  PaymentGateway,
  PaymentInFlightError,
} from '@/modules/payment/payment.gateway';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import type { InventoryReservedEvent } from '@/modules/messaging/events/order-events';

describe('PaymentGateway (idempotency)', () => {
  const repoMock = {
    query: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
  };
  let gateway: PaymentGateway;

  const event: InventoryReservedEvent = {
    orderId: 'order-1',
    userId: 'user-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
  };

  /** Scripts the two raw queries: the claim INSERT, then the staleness SELECT. */
  function claimResult(won: boolean, stale?: boolean): void {
    repoMock.query.mockResolvedValueOnce(won ? [{ orderId: 'order-1' }] : []);
    if (stale !== undefined) repoMock.query.mockResolvedValueOnce([{ stale }]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    repoMock.query.mockReset();
    gateway = new PaymentGateway(
      repoMock as unknown as Repository<PaymentAuthorizationEntity>,
    );
  });

  it('claims the ledger row before charging, then records the decision on it', async () => {
    claimResult(true);
    const charge = jest.spyOn(gateway, 'charge');

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
    expect(charge).toHaveBeenCalledWith(event, 'order-1');
    // Claim strictly precedes the provider call.
    expect(repoMock.query.mock.invocationCallOrder[0]).toBeLessThan(
      charge.mock.invocationCallOrder[0],
    );
    expect(repoMock.update).toHaveBeenCalledWith(
      { orderId: 'order-1', authorized: IsNull() },
      { authorized: true, declineReason: null },
    );
  });

  it('returns the stored decision without charging again on a repeat', async () => {
    claimResult(false);
    repoMock.findOneBy.mockResolvedValue({
      orderId: 'order-1',
      authorized: true,
      declineReason: null,
    });
    const charge = jest.spyOn(gateway, 'charge');

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
    expect(charge).not.toHaveBeenCalled();
    expect(repoMock.update).not.toHaveBeenCalled();
  });

  it('preserves a stored decline (reason and all) on a repeat', async () => {
    claimResult(false);
    repoMock.findOneBy.mockResolvedValue({
      orderId: 'order-1',
      authorized: false,
      declineReason: 'insufficient_funds',
    });

    const result = await gateway.authorize(event);

    expect(result).toEqual({
      authorized: false,
      declineReason: 'insufficient_funds',
    });
  });

  it('refuses to charge while another delivery holds a live claim', async () => {
    claimResult(false, false);
    repoMock.findOneBy.mockResolvedValue({
      orderId: 'order-1',
      authorized: null,
      declineReason: null,
    });
    const charge = jest.spyOn(gateway, 'charge');

    await expect(gateway.authorize(event)).rejects.toBeInstanceOf(
      PaymentInFlightError,
    );
    expect(charge).not.toHaveBeenCalled();
  });

  it('takes over a stale claim by re-calling the provider with the same idempotency key', async () => {
    claimResult(false, true);
    repoMock.findOneBy.mockResolvedValue({
      orderId: 'order-1',
      authorized: null,
      declineReason: null,
    });
    const charge = jest.spyOn(gateway, 'charge');

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
    expect(charge).toHaveBeenCalledWith(event, 'order-1');
    expect(repoMock.update).toHaveBeenCalledWith(
      { orderId: 'order-1', authorized: IsNull() },
      { authorized: true, declineReason: null },
    );
  });
});
