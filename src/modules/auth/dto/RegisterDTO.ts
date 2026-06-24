import { IsEmail, IsStrongPassword, MaxLength } from 'class-validator';

export class RegisterDTO {
  @IsEmail()
  email: string;

  // Strong-password defaults: min 8 chars with at least one lowercase,
  // uppercase, number and symbol (e.g. "SecurePass123!"). MaxLength guards
  // against bcrypt's 72-byte input truncation.
  @IsStrongPassword()
  @MaxLength(72)
  password: string;
}
