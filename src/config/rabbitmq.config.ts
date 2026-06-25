import { registerAs } from '@nestjs/config';

export interface RabbitMQConfig {
  /** AMQP connection URI. The exchange names are fixed topology constants. */
  uri: string;
}

export default registerAs(
  'rabbitmq',
  (): RabbitMQConfig => ({
    uri: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  }),
);
