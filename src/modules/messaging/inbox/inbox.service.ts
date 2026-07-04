import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';

const UNIQUE_VIOLATION = '23505';
const INBOX_TABLE = 'processed_messages';

function isInboxDuplicate(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; table?: string };
  return (
    driverError.code === UNIQUE_VIOLATION && driverError.table === INBOX_TABLE
  );
}

/**
 * Idempotency guard for at-least-once message delivery. Runs `work` at most once
 * per (messageId, consumer): the work and the inbox record are committed in a
 * single transaction, so a redelivery either sees the existing record (and
 * skips) or loses the race on the composite primary key (and skips). Either way
 * the side effect is applied exactly once.
 */
@Injectable()
export class InboxService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Returns true if `work` ran (first time), false if already processed. */
  async runOnce(
    messageId: string,
    consumer: string,
    work: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(ProcessedMessageEntity, {
          where: { messageId, consumer },
        });
        if (existing) {
          return false;
        }

        await work(manager);
        await manager.insert(ProcessedMessageEntity, { messageId, consumer });
        return true;
      });
    } catch (error) {
      // A concurrent delivery committed first; the unique PK rejected ours.
      // The side effect from this (rolled-back) transaction is undone, so it is
      // safe to treat the message as already processed. Only a violation on
      // the inbox table itself means that — a unique violation raised by
      // `work` (some other table) is a real failure and must retry/dead-letter
      // rather than be silently acked as a duplicate.
      if (isInboxDuplicate(error)) {
        return false;
      }
      throw error;
    }
  }
}
