import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ClsService } from 'nestjs-cls';
import { ORDER_EXCHANGE } from '@/modules/messaging/events/order-events';
import { CORRELATION_ID_HEADER } from '@/common/correlation/correlation.constants';
import { getCorrelationId } from '@/common/correlation/correlation';

/** Publishes lifecycle events to the order topic exchange. */
@Injectable()
export class EventPublisher {
  constructor(
    private readonly amqp: AmqpConnection,
    private readonly cls: ClsService,
  ) {}

  /**
   * Publishes a payload under `routingKey`. Each message carries a fresh
   * `messageId` so consumers can dedupe (see InboxService) and is persistent so
   * it survives a broker restart. The active correlation id rides along as a
   * header so the next consumer continues the same trace.
   */
  async publish(routingKey: string, payload: object): Promise<void> {
    const correlationId = getCorrelationId(this.cls) ?? randomUUID();
    await this.amqp.publish(ORDER_EXCHANGE, routingKey, payload, {
      messageId: randomUUID(),
      persistent: true,
      headers: { [CORRELATION_ID_HEADER]: correlationId },
    });
  }
}
