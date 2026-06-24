import { UserEntity } from '@/entities/user/UserEntity';
import { UserRole } from '@/entities/user/UserRole';

/**
 * Object Mother for {@link UserEntity}. Returns a persisted-looking user (with
 * id, a hashed password and the default role) by default; pass overrides to
 * vary individual fields.
 */
export class UserEntityMother {
  static create(overrides: Partial<UserEntity> = {}): UserEntity {
    const user = new UserEntity();
    user.id = 'some-uuid';
    user.email = 'test@example.com';
    user.password = 'hashed-password';
    user.role = UserRole.USER;
    user.createdAt = new Date('2026-01-01T00:00:00.000Z');
    return Object.assign(user, overrides);
  }
}
