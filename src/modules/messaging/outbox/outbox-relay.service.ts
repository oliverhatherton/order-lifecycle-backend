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
 * broker on a timer, independent of whatever request or consumer wrote the
 * row. A message only ever leaves this table once `amqp.publish` actually
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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly publisher: EventPublisher,
  ) {}

  @Interval(RELAY_POLL_INTERVAL_MS)
  async relay(): Promise<void> {
    // A tick that's still draining a large backlog skips the next timer fire
    // rather than overlapping it — SKIP LOCKED makes overlap safe, but there
    // is no value running two ticks against the same small batch size.
    if (this.draining) return;
    this.draining = true;
    try {
      await this.drainOnce();
    } catch (error) {
      this.logger.error('Outbox relay tick failed', error as Error);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
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
      return published.length;
    });

    if (relayed > 0) {
      recordOutboxRelayed(relayed);
      this.logger.log(`Relayed ${relayed} outbox message(s)`);
    }
  }
}
