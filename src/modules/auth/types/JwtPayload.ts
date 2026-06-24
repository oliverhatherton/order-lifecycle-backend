import type { UserRole } from '@/entities/user/UserRole';

/** Claims carried by the access token. */
export interface JwtPayload {
  /** User id (standard JWT subject claim). */
  sub: string;
  role: UserRole;
  /** Populated by the signer/verifier. */
  iat?: number;
  exp?: number;
}
