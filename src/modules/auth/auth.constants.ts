/** bcrypt cost factor shared by the registration flow and the admin CLI. */
export const BCRYPT_SALT_ROUNDS = 10;

/** Milliseconds in a day; basis for refresh-token lifetimes. */
export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Default refresh-token lifetime in days when `jwt.refreshExpiresInDays` is
 * absent. Single source so the stored token's expiry and the cookie's `maxAge`
 * cannot drift apart.
 */
export const REFRESH_TOKEN_TTL_DEFAULT_DAYS = 7;

/** Name of the httpOnly cookie that carries the refresh token. */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Path the refresh cookie is scoped to. Keeping it on the rotation endpoint
 * means the browser never transmits the refresh token to any other route.
 */
export const REFRESH_TOKEN_COOKIE_PATH = '/auth/refresh';
