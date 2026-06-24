import type { UserRole } from '@/entities/user/UserRole';
import type { UserEntity } from '@/entities/user/UserEntity';

/** Public, password-free view of a user returned by the admin endpoints. */
export type UserResponseDTO = {
  id: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  createdAt: Date;
};

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
