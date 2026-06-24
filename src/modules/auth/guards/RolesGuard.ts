import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@/entities/user/UserRole';
import { ROLES_KEY } from '@/modules/auth/decorators/Roles';
import { AuthenticatedRequest } from '@/modules/auth/types/AuthenticatedRequest';

/**
 * Authorises a request against the roles declared by {@link Roles}. Must run
 * after {@link JwtAuthGuard}, which authenticates the request and attaches the
 * access-token payload. ADMIN is a superset of every role, so an administrator
 * satisfies any role requirement; absent a requirement the route is open to
 * any authenticated caller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (
      user?.role === UserRole.ADMIN ||
      (user && requiredRoles.includes(user.role))
    ) {
      return true;
    }

    throw new ForbiddenException('Insufficient permissions');
  }
}
