import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { CorrelationLogger } from '@/common/correlation/correlation.logger';
import { buildValidationPipe } from '@/common/validation/validation-pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Stamp every log line with the active correlation id (see CLS middleware).
  app.useLogger(new CorrelationLogger(app.get(ClsService)));
  app.use(cookieParser());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(buildValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Order Lifecycle API')
    .setDescription(
      'Identity & access, the order lifecycle (FSM), and event-driven fulfilment.',
    )
    .setVersion('1.0')
    // Access token sent as `Authorization: Bearer <jwt>`.
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    // Refresh token delivered as an httpOnly cookie.
    .addCookieAuth('refresh_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Application listening on port ${port}`, 'Bootstrap');
  Logger.log(`API docs at http://localhost:${port}/docs`, 'Bootstrap');
}
void bootstrap();
