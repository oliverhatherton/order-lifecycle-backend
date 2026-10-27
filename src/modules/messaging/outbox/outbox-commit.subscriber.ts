import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { OutboxRelayService } from '@/modules/messaging/outbox/outbox-relay.service';

/**
 * Wakes the outbox relay the moment a transaction that wrote an outbox row
 * commits, instead of leaving the row for the next 1s poll. That poll is what
 * every pipeline hop used to wait on (about 0.5s per hop on average), so this
 * takes Pay → completed from roughly a second and a half to tens of
 * milliseconds.
 *
 * The guarantee is unchanged: the row is still written in the business
 * transaction, the nudge only fires after it commits (never on rollback), and
 * the timer-driven poll stays as the safety net for anything a nudge misses —
 * a crash between commit and publish, or rows committed by another instance.
 *
 * Query runners are tracked in a WeakSet: one transaction can insert several
 * outbox rows, and a runner that's done is collected with nothing to clean up.
 */
@Injectable()
export class OutboxCommitSubscriber implements EntitySubscriberInterface<OutboxMessageEntity> {
  private readonly pending = new WeakSet<QueryRunner>();

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly relay: OutboxRelayService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo(): typeof OutboxMessageEntity {
    return OutboxMessageEntity;
  }

  afterInsert(event: InsertEvent<OutboxMessageEntity>): void {
    if (event.queryRunner.isTransactionActive) {
      this.pending.add(event.queryRunner);
    } else {
      // Written outside a transaction: it's already committed.
      this.relay.nudge();
    }
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    if (this.pending.delete(event.queryRunner)) this.relay.nudge();
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.pending.delete(event.queryRunner);
  }
}
