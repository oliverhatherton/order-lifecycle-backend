/**
 * Internal pairing of an access token and its companion refresh token, as
 * minted by the {@link TokenService}. The HTTP layer splits these: the access
 * token goes in the response body, the refresh token in an httpOnly cookie.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
