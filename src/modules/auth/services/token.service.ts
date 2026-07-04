import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
   * pair, revoking the presented token (rotation). The replacement joins the
   * presented token's family — the chain of tokens descended from one login.
   * Re-presenting an already-rotated token is treated as theft: that family
   * (and only that family — the user's other sessions are untouched) is
   * revoked. Every rejection path returns the same generic error so callers
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

    if (stored.revoked) {
      return this.revokeFamilyOnReuse(stored);
    }

    if (stored.expiresAt.getTime() <= Date.now() || !stored.user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate with an atomic claim: only one caller can flip `revoked` for a
    // given token. Two concurrent refreshes with the same token both read
    // `revoked = false` above, but only one UPDATE matches — the loser is
    // presenting a token that has, by now, been rotated, which is reuse.
    const claim = await this.refreshTokenRepository.update(
      { id: stored.id, revoked: false },
      { revoked: true },
    );
    if (claim.affected === 0) {
      return this.revokeFamilyOnReuse(stored);
    }

    return this.issueTokens(stored.user, stored.familyId);
  }

  /**
   * Issues a signed access token plus a persisted (hashed) refresh token.
   * A login starts a new family; rotation passes the existing one through.
   */
  async issueTokens(
    user: UserEntity,
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.createRefreshToken(user.id, familyId);

    return { accessToken, refreshToken };
  }

  /**
   * Reuse detection: a rotated token being presented again means a copy of
   * it was stolen — either the thief or the legitimate client already holds
   * its successor. Revoke every token in the family so neither can continue.
   */
  private async revokeFamilyOnReuse(
    stored: RefreshTokenEntity,
  ): Promise<never> {
    this.logger.warn(
      `Refresh token reuse detected for user ${stored.userId}; revoking family ${stored.familyId}`,
    );
    await this.refreshTokenRepository.update(
      { familyId: stored.familyId },
      { revoked: true },
    );
    throw new UnauthorizedException('Invalid refresh token');
  }

  /** Generates an opaque refresh token and stores only its hash server-side. */
  private async createRefreshToken(
    userId: string,
    familyId: string,
  ): Promise<string> {
    const refreshToken = randomBytes(48).toString('base64url');
    const days =
      this.configService.get<number>('jwt.refreshExpiresInDays') ??
      REFRESH_TOKEN_TTL_DEFAULT_DAYS;

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId,
        familyId,
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
