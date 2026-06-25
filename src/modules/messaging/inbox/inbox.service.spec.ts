import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { InboxService } from '@/modules/messaging/inbox/inbox.service';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';

describe('InboxService', () => {
  const managerMock = { findOne: jest.fn(), insert: jest.fn() };
  const dataSourceMock = { transaction: jest.fn() };

  let service: InboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InboxService(dataSourceMock as unknown as DataSource);
  });

  /** Makes the mocked transaction invoke its callback with the mock manager. */
  function runTransaction(): void {
    dataSourceMock.transaction.mockImplementation(
      (cb: (m: EntityManager) => Promise<boolean>) =>
        cb(managerMock as unknown as EntityManager),
    );
  }

  it('runs work once and records the message on first delivery', async () => {
    managerMock.findOne.mockResolvedValue(null);
    runTransaction();
    const work = jest.fn().mockResolvedValue(undefined);

    const ran = await service.runOnce('msg-1', 'inventory', work);

    expect(ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    expect(managerMock.insert).toHaveBeenCalledWith(ProcessedMessageEntity, {
      messageId: 'msg-1',
      consumer: 'inventory',
    });
  });

  it('skips work when the message was already processed', async () => {
    managerMock.findOne.mockResolvedValue({
      messageId: 'msg-1',
      consumer: 'inventory',
    });
    runTransaction();
    const work = jest.fn();

    const ran = await service.runOnce('msg-1', 'inventory', work);

    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(managerMock.insert).not.toHaveBeenCalled();
  });

  it('treats a unique-violation race as already processed', async () => {
    dataSourceMock.transaction.mockRejectedValue(
      new QueryFailedError('insert', [], { code: '23505' } as unknown as Error),
    );

    const ran = await service.runOnce('msg-1', 'inventory', jest.fn());

    expect(ran).toBe(false);
  });

  it('rethrows unexpected errors', async () => {
    dataSourceMock.transaction.mockRejectedValue(new Error('db down'));

    await expect(
      service.runOnce('msg-1', 'inventory', jest.fn()),
    ).rejects.toThrow('db down');
  });
});
