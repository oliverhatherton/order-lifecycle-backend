import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * A lifecycle event queued for the broker, written in the same DB transaction
 * as the business change it announces (see OutboxService.enqueue). This is
 * the fix for the "publish-after-commit" gap: previously a service committed
 * its write and then called EventPublisher.publish as a separate step, so a
 * broker hiccup between the two silently dropped the event with only a log
 * line. Writing the event here instead means it either commits atomically
 * with the business change or not at all — OutboxRelayService is the only
 * thing that ever talks to RabbitMQ on this row's behalf, polling for
 * `publishedAt IS NULL` and retrying indefinitely until it succeeds.
 *
 * `id` doubles as the AMQP `messageId`, generated once at enqueue time and
 * reused verbatim by the relay (including on every retry) — so a message
 * relayed twice (crash between publish and marking `publishedAt`) still
 * dedupes correctly through the consumer-side inbox.
 */
@Entity('outbox_messages')
@Index(['publishedAt', 'createdAt'])
export class OutboxMessageEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  exchange: string;

  @Column()
  routingKey: string;

  @Column({ type: 'jsonb' })
  payload: object;

  /**
   * The correlation id active when the event was enqueued, captured here
   * because the relay publishes later, outside the request/consumer's CLS
   * context where the live id would otherwise be read.
   */
  @Column()
  correlationId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Null until the relay successfully publishes this row. */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
