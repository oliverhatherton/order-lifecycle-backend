import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { recordOutboxRelayed } from '@/modules/metrics/metrics.collectors';

/** How often the relay polls for unpublished rows. */
const RELAY_POLL_INTERVAL_MS = 1000;
/** Rows claimed per tick — bounds how long one tick can hold its row locks. */
const RELAY_BATCH_SIZE = 50;

/**
 * The other half of the outbox pattern: OutboxService durably records an
 * event inside the caller's own transaction; this drains that table to the
 * broker — immediately when OutboxCommitSubscriber nudges it after a commit,
 * and on a 1s timer as the safety net, independent of whatever request or
 * consumer wrote the row. A message only ever leaves this table once `amqp.publish` actually
 * succeeds — a broker outage just means rows pile up unpublished until it
 * recovers, instead of the event being silently lost.
 *
 * Row selection uses `FOR UPDATE SKIP LOCKED` so more than one app instance
 * can run this relay concurrently without duplicating work: each instance's
 * tick claims a disjoint batch, and one instance never blocks waiting on rows
 * another has already claimed. This is the one place in the app that is
 * already safe to run on more than one instance — everything else (the
 * @Cron stock replenishment, the system-metrics sampler) is not.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private draining = false;
  private drainAgain = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Drain now rather than at the next poll — called by OutboxCommitSubscriber
   * when a transaction that wrote outbox rows commits. If a drain is already
   * running, one more is queued for when it finishes, so a row committed
   * mid-drain (after that drain's SELECT) is never left for the poll.
   */
  nudge(): void {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    setImmediate(() => void this.relay());
  }

  @Interval(RELAY_POLL_INTERVAL_MS)
  async relay(): Promise<void> {
    // A tick that's still draining skips the next timer fire rather than
    // overlapping it — SKIP LOCKED makes overlap safe, but there is no value
    // running two drains against the same small batch size.
    if (this.draining) return;
    this.draining = true;
    try {
      // Keep going while full batches come back (a backlog after an outage).
      while ((await this.drainOnce()) === RELAY_BATCH_SIZE);
    } catch (error) {
      this.logger.error('Outbox relay tick failed', error as Error);
    } finally {
      this.draining = false;
    }
    if (this.drainAgain) {
      this.drainAgain = false;
      setImmediate(() => void this.relay());
    }
  }

  /** Publishes one batch; returns how many rows were claimed. */
  private async drainOnce(): Promise<number> {
    const relayed = await this.dataSource.transaction(async (manager) => {
      // Holding these row locks for the duration of the AMQP calls below is
      // a deliberate simplification — it bounds a tick to RELAY_BATCH_SIZE
      // publishes rather than pipelining network I/O outside the lock, which
      // would be the next optimisation if relay throughput ever became the
      // bottleneck.
      const batch = await manager
        .createQueryBuilder(OutboxMessageEntity, 'outbox')
        .where('outbox.publishedAt IS NULL')
        .orderBy('outbox.createdAt', 'ASC')
        .limit(RELAY_BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      const published: string[] = [];
      for (const row of batch) {
        try {
          await this.publisher.publish(
            row.exchange,
            row.routingKey,
            row.payload,
            row.id,
            row.correlationId,
          );
          published.push(row.id);
        } catch (error) {
          this.logger.error(
            `Failed to relay outbox message ${row.id}; will retry next tick`,
            error as Error,
          );
        }
      }

      if (published.length > 0) {
        await manager.update(OutboxMessageEntity, published, {
          publishedAt: new Date(),
        });
      }
      return { published: published.length, claimed: batch.length };
    });

    if (relayed.published > 0) {
      recordOutboxRelayed(relayed.published);
      this.logger.log(`Relayed ${relayed.published} outbox message(s)`);
    }
    return relayed.claimed;
  }
}
