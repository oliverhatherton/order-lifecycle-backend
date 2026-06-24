import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '@/modules/auth/types/AuthenticatedRequest';
import { JwtPayload } from '@/modules/auth/types/JwtPayload';

/** Extracts the verified access-token payload attached by {@link JwtAuthGuard}. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
