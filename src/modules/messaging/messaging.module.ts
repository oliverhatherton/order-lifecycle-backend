import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

/**
 * Owns the RabbitMQ connection and declares the lifecycle topology on boot: the
 * topic exchange that carries order events plus a dead-letter exchange that
 * poison messages are routed to (per-queue dead-lettering + retry land with the
 * consumers in later stories). Re-exports RabbitMQModule so feature modules can
 * inject AmqpConnection to publish or subscribe.
 */
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const exchange = configService.getOrThrow<string>('rabbitmq.exchange');
        return {
          uri: configService.getOrThrow<string>('rabbitmq.uri'),
          exchanges: [
            { name: exchange, type: 'topic' },
            { name: `${exchange}.dlx`, type: 'topic' },
          ],
          connectionInitOptions: { wait: true, timeout: 20000 },
        };
      },
    }),
  ],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
