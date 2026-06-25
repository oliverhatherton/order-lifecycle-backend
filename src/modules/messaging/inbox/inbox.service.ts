import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ProcessedMessageEntity } from '@/entities/processed-message/ProcessedMessageEntity';

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
      // safe to treat the message as already processed.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        return false;
      }
      throw error;
    }
  }
}
