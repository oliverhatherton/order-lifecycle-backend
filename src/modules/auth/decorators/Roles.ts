import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@/entities/user/UserRole';

/** Reflector key under which {@link Roles} stores the required roles. */
export const ROLES_KEY = 'roles';

/**
 * Marks a route (or controller) with the roles allowed to access it. Pair with
 * {@link RolesGuard} after {@link JwtAuthGuard}. `@Roles(UserRole.USER)` means
 * "any authenticated user" (ADMIN is treated as a superset), while
 * `@Roles(UserRole.ADMIN)` restricts the route to administrators.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
