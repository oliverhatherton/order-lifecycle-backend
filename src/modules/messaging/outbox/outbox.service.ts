import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { EntityManager } from 'typeorm';
import { OutboxMessageEntity } from '@/entities/outbox-message/OutboxMessageEntity';
import { ORDER_EXCHANGE } from '@/modules/messaging/events/order-events';
import { getCorrelationId } from '@/common/correlation/correlation';

/**
 * Writes a lifecycle event to the outbox table instead of publishing it
 * directly — the write goes through the caller's own EntityManager, so it
 * commits atomically with whatever business change it announces (an order
 * transition, a payment claim). OutboxRelayService picks the row up and
 * publishes it to the broker afterwards, on its own schedule.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly cls: ClsService) {}

  async enqueue(
    manager: EntityManager,
    routingKey: string,
    payload: object,
  ): Promise<void> {
    await manager.insert(OutboxMessageEntity, {
      id: randomUUID(),
      exchange: ORDER_EXCHANGE,
      routingKey,
      payload,
      correlationId: getCorrelationId(this.cls) ?? randomUUID(),
    });
  }
}
