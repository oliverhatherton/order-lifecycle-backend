import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';
import {
  DAY_IN_MS,
  REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_TTL_DEFAULT_DAYS,
} from '@/modules/auth/auth.constants';

/**
 * Builds the attributes for the refresh-token cookie. `httpOnly` keeps it out
 * of reach of page JavaScript (XSS), `sameSite` (default `strict`) governs
 * whether a cross-site request may carry it, and `secure` restricts it to HTTPS
 * outside development. The cookie's lifetime mirrors the stored token's expiry
 * so the browser drops it once the server-side token is dead.
 *
 * A UI on a **different origin** than the API must set `COOKIE_SAMESITE=none`
 * (browsers only honour `none` alongside `secure`, i.e. HTTPS in production) so
 * the refresh cookie is sent cross-site; keep `strict` when UI and API are
 * same-site.
 */
export function buildRefreshTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const days =
    configService.get<number>('jwt.refreshExpiresInDays') ??
    REFRESH_TOKEN_TTL_DEFAULT_DAYS;

  const sameSite = (process.env.COOKIE_SAMESITE ?? 'strict') as
    | 'strict'
    | 'lax'
    | 'none';

  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction || sameSite === 'none',
    sameSite,
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: days * DAY_IN_MS,
  };
}
