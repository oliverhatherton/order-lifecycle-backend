import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@/entities/user/UserRole';

/** Identity of the authenticated caller, derived from the access token. */
export class AuthMeResponseDTO {
  @ApiProperty({
    format: 'uuid',
    description: 'Authenticated user id (the JWT `sub` claim).',
  })
  userId: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;
}
