import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { UserEntity } from '@/entities/user/UserEntity';
import { TokenPair } from '@/modules/auth/types/TokenPair';
import { JwtPayload } from '@/modules/auth/types/JwtPayload';
import {
  DAY_IN_MS,
  REFRESH_TOKEN_TTL_DEFAULT_DAYS,
} from '@/modules/auth/auth.constants';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepository: Repository<RefreshTokenEntity>,
  ) {}

  /**
   * Exchanges a valid refresh token for a brand-new access + refresh token
   * pair, revoking the presented token (rotation). Re-presenting an
   * already-rotated token is treated as theft: the user's whole token family
   * is revoked. Every rejection path returns the same generic error so callers
   * cannot distinguish unknown vs expired vs revoked tokens.
   */
  async rotate(presentedToken: string): Promise<TokenPair> {
    const stored = await this.refreshTokenRepository.findOne({
      where: { tokenHash: this.hashRefreshToken(presentedToken) },
      relations: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A disabled user cannot refresh, even with an otherwise-valid token.
    // Checked before reuse detection so it is not mislabelled as theft.
    if (stored.user?.disabled) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection: a token that was already rotated being presented again
    // signals the token was stolen. Revoke the entire family defensively.
    if (stored.revoked) {
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoking all tokens`,
      );
      await this.refreshTokenRepository.update(
        { userId: stored.userId },
        { revoked: true },
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt.getTime() <= Date.now() || !stored.user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: revoke the presented token before issuing its replacement.
    stored.revoked = true;
    await this.refreshTokenRepository.save(stored);

    return this.issueTokens(stored.user);
  }

  /** Issues a signed access token plus a persisted (hashed) refresh token. */
  async issueTokens(user: UserEntity): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.createRefreshToken(user.id);

    return { accessToken, refreshToken };
  }

  /** Generates an opaque refresh token and stores only its hash server-side. */
  private async createRefreshToken(userId: string): Promise<string> {
    const refreshToken = randomBytes(48).toString('base64url');
    const days =
      this.configService.get<number>('jwt.refreshExpiresInDays') ??
      REFRESH_TOKEN_TTL_DEFAULT_DAYS;

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + days * DAY_IN_MS),
      }),
    );

    return refreshToken;
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
