import { ConsoleLogger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CORRELATION_CLS_KEY } from '@/common/correlation/correlation.constants';

/**
 * ConsoleLogger that prefixes every line with the active correlation id, so a
 * request and all the consumer hops it triggers can be grepped together. Outside
 * a CLS context (e.g. during bootstrap) it logs unchanged.
 */
export class CorrelationLogger extends ConsoleLogger {
  constructor(private readonly cls: ClsService) {
    super();
  }

  private decorate(message: unknown): unknown {
    if (typeof message !== 'string' || !this.cls.isActive()) {
      return message;
    }
    const id = this.cls.get<string>(CORRELATION_CLS_KEY);
    return id ? `[${id}] ${message}` : message;
  }

  log(message: unknown, ...rest: unknown[]): void {
    super.log(this.decorate(message), ...(rest as [string?]));
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(this.decorate(message), ...(rest as [string?, string?]));
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(this.decorate(message), ...(rest as [string?]));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(this.decorate(message), ...(rest as [string?]));
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(this.decorate(message), ...(rest as [string?]));
  }
}
