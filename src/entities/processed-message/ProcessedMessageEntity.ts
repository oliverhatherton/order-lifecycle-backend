import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Inbox record marking a broker message as processed by a given consumer. The
 * composite primary key (messageId, consumer) makes "process once per consumer"
 * a database invariant: a redelivered message cannot be recorded — or applied —
 * twice. Inserted in the same transaction as the side effect (see InboxService).
 */
@Entity('processed_messages')
export class ProcessedMessageEntity {
  @PrimaryColumn()
  messageId: string;

  @PrimaryColumn()
  consumer: string;

  @CreateDateColumn()
  processedAt: Date;
}
