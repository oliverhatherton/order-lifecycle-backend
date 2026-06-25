import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsStrongPassword, MaxLength } from 'class-validator';

export class RegisterDTO {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  // Strong-password defaults: min 8 chars with at least one lowercase,
  // uppercase, number and symbol (e.g. "SecurePass123!"). MaxLength guards
  // against bcrypt's 72-byte input truncation.
  @ApiProperty({
    example: 'SecurePass123!',
    description:
      'Min 8 chars with lowercase, uppercase, number and symbol; max 72 bytes.',
  })
  @IsStrongPassword()
  @MaxLength(72)
  password: string;
}
