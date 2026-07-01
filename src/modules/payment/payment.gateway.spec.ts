import { QueryFailedError, Repository } from 'typeorm';
import { PaymentGateway } from '@/modules/payment/payment.gateway';
import { PaymentAuthorizationEntity } from '@/entities/payment-authorization/PaymentAuthorizationEntity';
import type { InventoryReservedEvent } from '@/modules/messaging/events/order-events';

describe('PaymentGateway (idempotency)', () => {
  const repoMock = {
    findOneBy: jest.fn(),
    insert: jest.fn(),
  };
  let gateway: PaymentGateway;

  const event: InventoryReservedEvent = {
    orderId: 'order-1',
    userId: 'user-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new PaymentGateway(
      repoMock as unknown as Repository<PaymentAuthorizationEntity>,
    );
  });

  it('charges once and stores the decision on first authorization', async () => {
    repoMock.findOneBy.mockResolvedValue(null);
    repoMock.insert.mockResolvedValue(undefined);
    const charge = jest.spyOn(gateway, 'charge');

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(repoMock.insert).toHaveBeenCalledWith({
      orderId: 'order-1',
      authorized: true,
      declineReason: null,
    });
  });

  it('returns the stored decision without charging again on a repeat', async () => {
    repoMock.findOneBy.mockResolvedValue({
      orderId: 'order-1',
      authorized: true,
      declineReason: null,
    });
    const charge = jest.spyOn(gateway, 'charge');

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
    expect(charge).not.toHaveBeenCalled();
    expect(repoMock.insert).not.toHaveBeenCalled();
  });

  it('preserves a stored decline (reason and all) on a repeat', async () => {
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

  it('resolves a concurrent insert race by returning the stored decision', async () => {
    // No row on first read, but a concurrent delivery inserts before us.
    repoMock.findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce({
      orderId: 'order-1',
      authorized: true,
      declineReason: null,
    });
    repoMock.insert.mockRejectedValue(
      new QueryFailedError('insert', undefined, {
        code: '23505',
      } as unknown as Error),
    );

    const result = await gateway.authorize(event);

    expect(result).toEqual({ authorized: true });
  });
});
