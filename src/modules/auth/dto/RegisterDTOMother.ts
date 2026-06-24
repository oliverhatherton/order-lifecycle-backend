import { RegisterDTO } from '@/modules/auth/dto/RegisterDTO';

/**
 * Object Mother for {@link RegisterDTO}. Returns a valid payload by default;
 * pass overrides to vary individual fields.
 */
export class RegisterDTOMother {
  static valid(overrides: Partial<RegisterDTO> = {}): RegisterDTO {
    return {
      email: 'test@example.com',
      password: 'SecurePass123!',
      ...overrides,
    };
  }
}
