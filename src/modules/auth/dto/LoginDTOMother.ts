import { LoginDTO } from '@/modules/auth/dto/LoginDTO';

/**
 * Object Mother for {@link LoginDTO}. Returns valid credentials matching the
 * registration mother defaults; pass overrides to vary individual fields.
 */
export class LoginDTOMother {
  static valid(overrides: Partial<LoginDTO> = {}): LoginDTO {
    return {
      email: 'test@example.com',
      password: 'SecurePass123!',
      ...overrides,
    };
  }
}
