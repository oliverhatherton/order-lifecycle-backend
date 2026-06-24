import { Request } from 'express';
import { JwtPayload } from '@/modules/auth/types/JwtPayload';

/** A request authenticated by {@link JwtAuthGuard}, carrying the token payload. */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
