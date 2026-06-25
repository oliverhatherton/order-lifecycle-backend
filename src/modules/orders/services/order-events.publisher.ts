import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderEntity } from '@/entities/order/OrderEntity';
import {
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

/** Publishes order lifecycle events to the topic exchange. */
@Injectable()
export class OrderEventsPublisher {
  private readonly logger = new Logger(OrderEventsPublisher.name);
  private readonly exchange: string;

  constructor(
    private readonly amqp: AmqpConnection,
    configService: ConfigService,
  ) {
    this.exchange = configService.getOrThrow<string>('rabbitmq.exchange');
  }

  async publishOrderCreated(order: OrderEntity): Promise<void> {
    const event: OrderCreatedEvent = {
      orderId: order.id,
      userId: order.userId,
      occurredAt: new Date().toISOString(),
    };

    // messageId gives consumers a stable key for idempotency (see the inbox in
    // Story 3.2); persistent survives a broker restart.
    await this.amqp.publish(this.exchange, OrderRoutingKey.Created, event, {
      messageId: randomUUID(),
      persistent: true,
    });
    this.logger.log(
      `Published ${OrderRoutingKey.Created} for order ${order.id}`,
    );
  }
}
