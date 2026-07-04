import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { TokenService } from '@/modules/auth/services/token.service';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';

const sha256 = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

describe('TokenService', () => {
  let service: TokenService;

  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn(),
  };

  const refreshTokenRepositoryMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        {
          provide: getRepositoryToken(RefreshTokenEntity),
          useValue: refreshTokenRepositoryMock,
        },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('issueTokens', () => {
    it('signs an access token and persists a hashed refresh token', async () => {
      const user = UserEntityMother.create();
      jwtServiceMock.signAsync.mockResolvedValue('access-token');
      configServiceMock.get.mockReturnValue(7);
      refreshTokenRepositoryMock.create.mockImplementation(
        (value: Partial<RefreshTokenEntity>) => value,
      );

      const result = await service.issueTokens(user);

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        role: user.role,
      });
      expect(result.accessToken).toBe('access-token');
      expect(typeof result.refreshToken).toBe('string');

      // The plaintext token is never persisted — only its SHA-256 hash.
      const [persisted] = refreshTokenRepositoryMock.save.mock.calls[0] as [
        RefreshTokenEntity,
      ];
      expect(persisted.tokenHash).toBe(sha256(result.refreshToken));
      expect(persisted.userId).toBe(user.id);
    });

    it('starts a new token family per login', async () => {
      const user = UserEntityMother.create();
      jwtServiceMock.signAsync.mockResolvedValue('access-token');
      configServiceMock.get.mockReturnValue(7);
      refreshTokenRepositoryMock.create.mockImplementation(
        (value: Partial<RefreshTokenEntity>) => value,
      );

      await service.issueTokens(user);
      await service.issueTokens(user);

      const [[first], [second]] = refreshTokenRepositoryMock.save.mock
        .calls as [[RefreshTokenEntity], [RefreshTokenEntity]];
      expect(first.familyId).toEqual(expect.any(String));
      expect(first.familyId).not.toBe(second.familyId);
    });
  });

  describe('rotate', () => {
    it('rejects an unknown refresh token with a generic error', async () => {
      refreshTokenRepositoryMock.findOne.mockResolvedValue(null);

      await expect(service.rotate('nope')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(refreshTokenRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token with a generic error', async () => {
      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        userId: 'user-id',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
        user: UserEntityMother.create(),
      });

      await expect(service.rotate('expired')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(refreshTokenRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('atomically revokes the presented token and issues a successor in the same family', async () => {
      const user = UserEntityMother.create();
      const stored = {
        id: 'token-id',
        userId: user.id,
        familyId: 'family-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 60_000),
        user,
      };
      refreshTokenRepositoryMock.findOne.mockResolvedValue(stored);
      refreshTokenRepositoryMock.update.mockResolvedValue({ affected: 1 });
      jwtServiceMock.signAsync.mockResolvedValue('new-access-token');
      configServiceMock.get.mockReturnValue(7);
      refreshTokenRepositoryMock.create.mockImplementation(
        (value: Partial<RefreshTokenEntity>) => value,
      );

      const result = await service.rotate('valid');

      // The old token is revoked via a conditional claim...
      expect(refreshTokenRepositoryMock.update).toHaveBeenCalledWith(
        { id: 'token-id', revoked: false },
        { revoked: true },
      );
      // ...its successor stays in the same family...
      const [persisted] = refreshTokenRepositoryMock.save.mock.calls[0] as [
        RefreshTokenEntity,
      ];
      expect(persisted.familyId).toBe('family-1');
      // ...and a brand-new pair is returned.
      expect(result.accessToken).toBe('new-access-token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
    });

    it('treats losing the rotation claim to a concurrent refresh as reuse', async () => {
      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        id: 'token-id',
        userId: 'user-id',
        familyId: 'family-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 60_000),
        user: UserEntityMother.create(),
      });
      // The claim matches nothing — another request rotated it first.
      refreshTokenRepositoryMock.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.rotate('raced')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(refreshTokenRepositoryMock.update).toHaveBeenLastCalledWith(
        { familyId: 'family-1' },
        { revoked: true },
      );
      expect(refreshTokenRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('rejects refresh for a disabled user without rotating the token', async () => {
      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        userId: 'user-id',
        revoked: false,
        expiresAt: new Date(Date.now() + 60_000),
        user: UserEntityMother.create({ disabled: true }),
      });

      await expect(service.rotate('valid-but-disabled')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(refreshTokenRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('treats re-presenting a revoked token as reuse and revokes only its family', async () => {
      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        userId: 'user-id',
        familyId: 'family-1',
        revoked: true,
        expiresAt: new Date(Date.now() + 60_000),
        user: UserEntityMother.create(),
      });

      await expect(service.rotate('rotated-already')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(refreshTokenRepositoryMock.update).toHaveBeenCalledWith(
        { familyId: 'family-1' },
        { revoked: true },
      );
    });

    it('rejection paths share the same generic message and type', async () => {
      const errors: unknown[] = [];

      refreshTokenRepositoryMock.findOne.mockResolvedValue(null);
      errors.push(await service.rotate('unknown').catch((e: unknown) => e));

      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        userId: 'user-id',
        revoked: false,
        expiresAt: new Date(Date.now() - 1000),
        user: UserEntityMother.create(),
      });
      errors.push(await service.rotate('expired').catch((e: unknown) => e));

      refreshTokenRepositoryMock.findOne.mockResolvedValue({
        userId: 'user-id',
        revoked: true,
        expiresAt: new Date(Date.now() + 60_000),
        user: UserEntityMother.create(),
      });
      errors.push(await service.rotate('reused').catch((e: unknown) => e));

      for (const error of errors) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(
          'Invalid refresh token',
        );
      }
    });
  });
});
