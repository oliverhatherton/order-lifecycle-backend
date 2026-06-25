import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDTO {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  // Login only checks presence/type — never the registration strength rules,
  // which would otherwise leak password policy and reject legacy passwords.
  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
