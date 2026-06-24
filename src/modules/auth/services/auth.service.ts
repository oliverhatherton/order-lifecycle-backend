import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { RegisterDTO } from '@/modules/auth/dto/RegisterDTO';
import { LoginDTO } from '@/modules/auth/dto/LoginDTO';
import { TokenPair } from '@/modules/auth/types/TokenPair';
import { UserEntity } from '@/entities/user/UserEntity';
import { BCRYPT_SALT_ROUNDS } from '@/modules/auth/auth.constants';
import { TokenService } from '@/modules/auth/services/token.service';
import { normalizeEmail } from '@/common/utils/normalize-email';

// Constant-time guard: comparing against a real hash when no user is found
// keeps login timing uniform, preventing email enumeration via response time.
const DUMMY_PASSWORD_HASH =
  '$2b$10$xxXAnAbW0LPKpm7mhKYEbu/8wJV8K51H7x/qrnGzLJB/4s1dtYRJa';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly tokenService: TokenService,
  ) {}

  async login(loginDTO: LoginDTO): Promise<TokenPair> {
    const user = await this.userRepository.findOneBy({
      email: normalizeEmail(loginDTO.email),
    });

    // Always run a bcrypt compare so the response time does not reveal whether
    // the email exists.
    const passwordMatches = await bcrypt.compare(
      loginDTO.password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // A disabled account is rejected with the same generic error so the
    // response never reveals that the credentials were actually correct.
    if (user.disabled) {
      this.logger.warn(`Login blocked for disabled user ${user.id}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`User ${user.id} logged in`);
    return this.tokenService.issueTokens(user);
  }

  /** Rotates a refresh token into a fresh access + refresh token pair. */
  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokenService.rotate(refreshToken);
  }

  async register(registerDTO: RegisterDTO): Promise<UserEntity> {
    this.logger.log(`Registering user with email ${registerDTO.email}`);

    const hashedPassword = await bcrypt.hash(
      registerDTO.password,
      BCRYPT_SALT_ROUNDS,
    );

    const user = this.userRepository.create({
      email: registerDTO.email,
      password: hashedPassword,
    });

    try {
      const saved = await this.userRepository.save(user);
      this.logger.log(`Registered user ${saved.id}`);
      return saved;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        // Postgres unique_violation = '23505'; better-sqlite3 = 'SQLITE_CONSTRAINT_UNIQUE'
        const code = (error.driverError as { code?: string }).code;
        if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          this.logger.warn(
            `Registration rejected: email ${registerDTO.email} already exists`,
          );
          throw new ConflictException('Email already registered');
        }
      }
      throw error;
    }
  }
}
