// Must be first: starts OpenTelemetry before Nest and its deps are required.
import '@/tracing.bootstrap';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { CorrelationLogger } from '@/common/correlation/correlation.logger';
import { buildCorsOrigins } from '@/common/cors/cors-origin';
import { buildValidationPipe } from '@/common/validation/validation-pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Stamp every log line with the active correlation id (see CLS middleware).
  app.useLogger(new CorrelationLogger(app.get(ClsService)));
  app.use(cookieParser());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(buildValidationPipe());

  // Enable CORS only when an origin is configured (a browser UI on another
  // origin). `credentials: true` lets the refresh cookie flow cross-site.
  // Supports exact origins and `*.` subdomain wildcards (see buildCorsOrigins).
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    app.enableCors({
      origin: buildCorsOrigins(corsOrigin),
      credentials: true,
    });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Order Lifecycle API')
    .setDescription(
      [
        'Identity & access, the order lifecycle (FSM), and event-driven fulfilment.',
        '',
        '**Auth:** send the access token as `Authorization: Bearer <jwt>`; the',
        'refresh token is an httpOnly cookie rotated at `POST /auth/refresh`.',
        '',
        '**Orders:** `POST /orders` returns a PENDING order immediately; fulfilment',
        '(reserve → pay → complete) runs asynchronously, so poll `GET /orders/{id}`',
        'to watch the status advance to COMPLETED (or FAILED).',
      ].join('\n'),
    )
    .setVersion('1.0')
    // Access token sent as `Authorization: Bearer <jwt>`.
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    // Refresh token delivered as an httpOnly cookie.
    .addCookieAuth('refresh_token')
    .addTag('auth', 'Registration, login, token refresh and identity')
    .addTag('orders', 'Create and read the caller’s orders')
    .addTag('admin', 'Admin-only user management (requires ADMIN role)')
    .addTag('health', 'Liveness probe')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  // Bind 0.0.0.0 so the container is reachable by the host/proxy (e.g. Render).
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application listening on port ${port}`, 'Bootstrap');
  Logger.log(`API docs at http://localhost:${port}/docs`, 'Bootstrap');
}
void bootstrap();
