import { ApiProperty } from '@nestjs/swagger';

/**
 * HTTP response body for login and refresh. Only the access token is returned
 * in the body; the refresh token is delivered out-of-band as an httpOnly
 * cookie so it is never exposed to client-side JavaScript.
 */
export class AccessTokenResponseDTO {
  @ApiProperty({
    description: 'Short-lived JWT to send as `Authorization: Bearer <token>`.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}
