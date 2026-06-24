import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';
import {
  DAY_IN_MS,
  REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_TTL_DEFAULT_DAYS,
} from '@/modules/auth/auth.constants';

/**
 * Builds the attributes for the refresh-token cookie. `httpOnly` keeps it out
 * of reach of page JavaScript (XSS), `sameSite: 'strict'` stops a cross-site
 * request from triggering a silent refresh (CSRF), and `secure` restricts it
 * to HTTPS outside development. The cookie's lifetime mirrors the stored
 * token's expiry so the browser drops it once the server-side token is dead.
 */
export function buildRefreshTokenCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const days =
    configService.get<number>('jwt.refreshExpiresInDays') ??
    REFRESH_TOKEN_TTL_DEFAULT_DAYS;

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: days * DAY_IN_MS,
  };
}
