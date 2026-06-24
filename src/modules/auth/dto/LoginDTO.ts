import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDTO {
  @IsEmail()
  email: string;

  // Login only checks presence/type — never the registration strength rules,
  // which would otherwise leak password policy and reject legacy passwords.
  @IsString()
  @IsNotEmpty()
  password: string;
}
