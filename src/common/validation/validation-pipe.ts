import { ValidationPipe } from '@nestjs/common';

/**
 * Single source of truth for the app-wide validation behaviour so the runtime
 * (main.ts) and the e2e test bootstrap stay in sync.
 *
 * - `whitelist` strips properties without validation decorators
 * - `forbidNonWhitelisted` rejects requests carrying unexpected properties
 * - `transform` produces real DTO class instances
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
