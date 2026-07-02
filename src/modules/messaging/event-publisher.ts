import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { CORRELATION_ID_HEADER } from '@/common/correlation/correlation.constants';

/**
 * Thin wrapper around the broker connection. `messageId` and `correlationId`
 * are supplied by the caller rather than derived here — the sole caller is
 * OutboxRelayService, which runs outside any request/consumer's context and
 * publishes values already captured on an outbox row (see OutboxService).
 */
@Injectable()
export class EventPublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  async publish(
    exchange: string,
    routingKey: string,
    payload: object,
    messageId: string,
    correlationId: string,
  ): Promise<void> {
    await this.amqp.publish(exchange, routingKey, payload, {
      messageId,
      persistent: true,
      headers: { [CORRELATION_ID_HEADER]: correlationId },
    });
  }
}
