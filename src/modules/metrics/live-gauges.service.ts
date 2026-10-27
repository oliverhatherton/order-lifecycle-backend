import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Channel, ChannelModel } from 'amqplib';
import { DataSource } from 'typeorm';
import { OrderStatus } from '@/entities/order/OrderStatus';
import {
  ConsumerQueue,
  ORDER_DLQ,
} from '@/modules/messaging/events/order-events';
import {
  setLiveGaugeSource,
  type LiveGaugeSnapshot,
  type LiveGaugeSource,
} from '@/modules/metrics/metrics.collectors';

/** Queues whose depth/consumer count is exported: every work queue + the DLQ. */
export const MONITORED_QUEUES = [...Object.values(ConsumerQueue), ORDER_DLQ];

/**
 * One scrape fans out to every live gauge's collect(); they all share one
 * snapshot, and snapshots are reused for this long so several dashboards
 * polling at once don't multiply the DB and broker queries.
 */
const SNAPSHOT_TTL_MS = 2000;

/**
 * Supplies the point-in-time gauges in metrics.collectors (orders by status,
 * outbox backlog, queue depth/consumers) — the "is the pipeline healthy right
 * now" view that event counters can't give.
 *
 * The broker is looked up lazily (ModuleRef, non-strict) rather than injected,
 * so MetricsModule doesn't depend on MessagingModule: an app or test suite
 * without RabbitMQ still exports the DB-backed gauges. Queue checks use a
 * dedicated channel because amqplib closes a channel when `checkQueue` fails
 * (e.g. a queue not declared yet) — that must never take down the channel
 * the app publishes on. Every failure degrades to omitting that gauge, never
 * to failing the scrape.
 */
@Injectable()
export class LiveGaugesService
  implements LiveGaugeSource, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LiveGaugesService.name);
  private cached: { at: number; value: Promise<LiveGaugeSnapshot> } | undefined;
  private channel: Channel | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    setLiveGaugeSource(this);
  }

  async onModuleDestroy(): Promise<void> {
    setLiveGaugeSource(undefined);
    await this.channel?.close().catch(() => undefined);
    this.channel = undefined;
  }

  snapshot(): Promise<LiveGaugeSnapshot> {
    const now = Date.now();
    if (!this.cached || now - this.cached.at > SNAPSHOT_TTL_MS) {
      this.cached = { at: now, value: this.load() };
    }
    return this.cached.value;
  }

  private async load(): Promise<LiveGaugeSnapshot> {
    const [ordersByStatus, outbox, queues] = await Promise.all([
      this.ordersByStatus(),
      this.outbox(),
      this.queues(),
    ]);
    return { ordersByStatus, ...outbox, queues };
  }

  private async ordersByStatus(): Promise<Record<string, number>> {
    // Every status starts at 0 so an emptied state reads 0, not "missing".
    const counts: Record<string, number> = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, 0]),
    );
    try {
      const rows: Array<{ status: string; count: string }> =
        await this.dataSource.query(
          `SELECT "status", COUNT(*) AS "count" FROM "orders" GROUP BY "status"`,
        );
      for (const row of rows) counts[row.status] = Number(row.count);
    } catch (error) {
      this.logger.warn(`orders_in_status query failed: ${String(error)}`);
    }
    return counts;
  }

  private async outbox(): Promise<{
    outboxPending: number;
    outboxOldestAgeSeconds: number;
  }> {
    try {
      const [row]: Array<{ pending: string; age: string | null }> =
        await this.dataSource.query(
          `SELECT COUNT(*) AS "pending",
                  EXTRACT(EPOCH FROM (now() - MIN("createdAt"))) AS "age"
           FROM "outbox_messages" WHERE "publishedAt" IS NULL`,
        );
      return {
        outboxPending: Number(row.pending),
        outboxOldestAgeSeconds: row.age === null ? 0 : Number(row.age),
      };
    } catch (error) {
      this.logger.warn(`outbox gauge query failed: ${String(error)}`);
      return { outboxPending: 0, outboxOldestAgeSeconds: 0 };
    }
  }

  private async queues(): Promise<LiveGaugeSnapshot['queues']> {
    const results: LiveGaugeSnapshot['queues'] = [];
    for (const queue of MONITORED_QUEUES) {
      const channel = await this.queueChannel();
      if (!channel) break;
      try {
        const info = await channel.checkQueue(queue);
        results.push({
          queue,
          messages: info.messageCount,
          consumers: info.consumerCount,
        });
      } catch {
        // checkQueue failure closed the channel; reopen for the next queue.
        this.channel = undefined;
      }
    }
    return results;
  }

  private async queueChannel(): Promise<Channel | undefined> {
    if (this.channel) return this.channel;
    let amqp: AmqpConnection;
    try {
      amqp = this.moduleRef.get(AmqpConnection, { strict: false });
    } catch {
      return undefined; // no broker in this app (e.g. a slim test module)
    }
    try {
      // golevelup types `connection` as amqplib's Connection, but at runtime
      // it is the ChannelModel amqplib.connect() resolves to — the object
      // that actually has createChannel().
      const model = amqp.connection as unknown as ChannelModel;
      const channel = await model.createChannel();
      channel.on('error', () => undefined);
      channel.on('close', () => {
        if (this.channel === channel) this.channel = undefined;
      });
      this.channel = channel;
      return channel;
    } catch {
      return undefined;
    }
  }
}
