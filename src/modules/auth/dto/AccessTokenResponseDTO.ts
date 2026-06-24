/**
 * HTTP response body for login and refresh. Only the access token is returned
 * in the body; the refresh token is delivered out-of-band as an httpOnly
 * cookie so it is never exposed to client-side JavaScript.
 */
export type AccessTokenResponseDTO = {
  accessToken: string;
};
