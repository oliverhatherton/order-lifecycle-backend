import type { DataSource, QueryRunner } from 'typeorm';
import { OutboxCommitSubscriber } from '@/modules/messaging/outbox/outbox-commit.subscriber';
import type { OutboxRelayService } from '@/modules/messaging/outbox/outbox-relay.service';

describe('OutboxCommitSubscriber', () => {
  const nudge = jest.fn();
  const relay = { nudge } as unknown as OutboxRelayService;
  const dataSource = { subscribers: [] as unknown[] } as unknown as DataSource;

  function runner(inTransaction = true): QueryRunner {
    return { isTransactionActive: inTransaction } as QueryRunner;
  }

  beforeEach(() => jest.clearAllMocks());

  it('registers itself on the data source', () => {
    const subscriber = new OutboxCommitSubscriber(dataSource, relay);
    expect(dataSource.subscribers).toContain(subscriber);
  });

  it('nudges the relay once the transaction that wrote outbox rows commits', () => {
    const subscriber = new OutboxCommitSubscriber(dataSource, relay);
    const queryRunner = runner();

    subscriber.afterInsert({ queryRunner } as never);
    subscriber.afterInsert({ queryRunner } as never);
    expect(nudge).not.toHaveBeenCalled(); // not before commit

    subscriber.afterTransactionCommit({ queryRunner } as never);
    expect(nudge).toHaveBeenCalledTimes(1); // once per transaction
  });

  it('never nudges for a transaction that rolled back', () => {
    const subscriber = new OutboxCommitSubscriber(dataSource, relay);
    const queryRunner = runner();

    subscriber.afterInsert({ queryRunner } as never);
    subscriber.afterTransactionRollback({ queryRunner } as never);
    subscriber.afterTransactionCommit({ queryRunner } as never);

    expect(nudge).not.toHaveBeenCalled();
  });

  it('ignores commits of transactions that wrote no outbox rows', () => {
    const subscriber = new OutboxCommitSubscriber(dataSource, relay);

    subscriber.afterTransactionCommit({ queryRunner: runner() } as never);

    expect(nudge).not.toHaveBeenCalled();
  });

  it('nudges straight away for a row written outside a transaction', () => {
    const subscriber = new OutboxCommitSubscriber(dataSource, relay);

    subscriber.afterInsert({ queryRunner: runner(false) } as never);

    expect(nudge).toHaveBeenCalledTimes(1);
  });
});
