import { registerAs } from '@nestjs/config';

export interface RabbitMQConfig {
  /** AMQP connection URI. */
  uri: string;
  /** Topic exchange that carries the order lifecycle events. */
  exchange: string;
}

export default registerAs(
  'rabbitmq',
  (): RabbitMQConfig => ({
    uri: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    exchange: process.env.RABBITMQ_EXCHANGE ?? 'order_lifecycle',
  }),
);
