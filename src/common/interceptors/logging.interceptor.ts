import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const { method, originalUrl } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<Response>();
          const elapsed = Date.now() - startedAt;
          this.logger.log(
            `${method} ${originalUrl} ${response.statusCode} - ${elapsed}ms`,
          );
        },
        error: (error: { status?: number }) => {
          const elapsed = Date.now() - startedAt;
          this.logger.error(
            `${method} ${originalUrl} ${error.status ?? 500} - ${elapsed}ms`,
          );
        },
      }),
    );
  }
}
