import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ORDER_EXCHANGE } from '@/modules/messaging/events/order-events';

/** Publishes lifecycle events to the order topic exchange. */
@Injectable()
export class EventPublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  /**
   * Publishes a payload under `routingKey`. Each message carries a fresh
   * `messageId` so consumers can dedupe (see InboxService) and is persistent so
   * it survives a broker restart.
   */
  async publish(routingKey: string, payload: object): Promise<void> {
    await this.amqp.publish(ORDER_EXCHANGE, routingKey, payload, {
      messageId: randomUUID(),
      persistent: true,
    });
  }
}
