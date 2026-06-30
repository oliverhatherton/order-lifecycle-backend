import { randomUUID } from 'node:crypto';
import { DynamicModule } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import type { Request, Response } from 'express';
import type { ConsumeMessage } from 'amqplib';
import {
  CORRELATION_CLS_KEY,
  CORRELATION_ID_HEADER,
} from '@/common/correlation/correlation.constants';

/**
 * Returns a usable correlation id from an inbound header value, generating a
 * fresh UUID when none was supplied. Shared by the HTTP middleware and the
 * message-consumer entry so both adopt-or-generate identically.
 */
export function resolveCorrelationId(
  headerValue: string | string[] | undefined,
): string {
  if (typeof headerValue === 'string' && headerValue.trim() !== '') {
    return headerValue;
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return headerValue[0];
  }
  return randomUUID();
}

/** The correlation id for the active context, or undefined outside one. */
export function getCorrelationId(cls: ClsService): string | undefined {
  return cls.isActive() ? cls.get<string>(CORRELATION_CLS_KEY) : undefined;
}

/**
 * Runs a consumer's work inside a fresh CLS context seeded with the correlation
 * id carried on the message (or a new one), so the consumer's logs and anything
 * it publishes downstream continue the same id.
 */
export function runWithCorrelationId<T>(
  cls: ClsService,
  amqpMsg: ConsumeMessage,
  work: () => Promise<T>,
): Promise<T> {
  const header = amqpMsg.properties.headers?.[CORRELATION_ID_HEADER] as
    | string
    | undefined;
  const id = resolveCorrelationId(header);
  return cls.run(() => {
    cls.set(CORRELATION_CLS_KEY, id);
    return work();
  });
}

/**
 * The global CLS module: an HTTP middleware adopts an inbound `x-correlation-id`
 * (or generates one), stores it for the request and echoes it on the response.
 */
export function correlationClsModule(): DynamicModule {
  return ClsModule.forRoot({
    global: true,
    middleware: {
      mount: true,
      generateId: true,
      idGenerator: (req: Request) =>
        resolveCorrelationId(req.headers[CORRELATION_ID_HEADER]),
      setup: (cls: ClsService, _req: Request, res: Response) => {
        const id = cls.getId();
        cls.set(CORRELATION_CLS_KEY, id);
        res.setHeader(CORRELATION_ID_HEADER, id);
      },
    },
  });
}
