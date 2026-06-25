import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@/entities/user/UserRole';
import type { UserEntity } from '@/entities/user/UserEntity';

/** Public, password-free view of a user returned by the auth/admin endpoints. */
export class UserResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @ApiProperty({
    description: 'Disabled users cannot authenticate or refresh.',
  })
  disabled: boolean;

  @ApiProperty()
  createdAt: Date;
}

/** Maps a {@link UserEntity} to its safe response shape (never the password). */
export function toUserResponseDTO(user: UserEntity): UserResponseDTO {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}
