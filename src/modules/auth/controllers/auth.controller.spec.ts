import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from '@/modules/auth/controllers/auth.controller';
import { AuthService } from '@/modules/auth/services/auth.service';
import { RegisterDTOMother } from '@/modules/auth/dto/RegisterDTOMother';
import { LoginDTOMother } from '@/modules/auth/dto/LoginDTOMother';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';
import { UserRole } from '@/entities/user/UserRole';
import { REFRESH_TOKEN_COOKIE } from '@/modules/auth/auth.constants';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import type { JwtPayload } from '@/modules/auth/types/JwtPayload';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn().mockReturnValue(7),
  };

  const registerDTO = RegisterDTOMother.valid();

  const cookieMock = jest.fn();
  const res = { cookie: cookieMock } as unknown as Response;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates registration to AuthService and returns the user metadata', async () => {
    const createdUser = UserEntityMother.create({ email: registerDTO.email });
    authServiceMock.register.mockResolvedValue(createdUser);

    const result = await controller.register(registerDTO);

    expect(authServiceMock.register).toHaveBeenCalledWith(registerDTO);
    expect(result).toEqual({
      id: createdUser.id,
      email: createdUser.email,
      role: createdUser.role,
      disabled: createdUser.disabled,
      createdAt: createdUser.createdAt,
    });
  });

  it('does not expose the password in the response', async () => {
    const createdUser = UserEntityMother.create({ email: registerDTO.email });
    authServiceMock.register.mockResolvedValue(createdUser);

    const result = await controller.register(registerDTO);

    expect(result).not.toHaveProperty('password');
  });

  it('returns the access token in the body and sets the refresh token as an httpOnly cookie', async () => {
    const loginDTO = LoginDTOMother.valid();
    authServiceMock.login.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });

    const result = await controller.login(loginDTO, res);

    expect(authServiceMock.login).toHaveBeenCalledWith(loginDTO);
    expect(result).toEqual({ accessToken: 'access' });
    expect(cookieMock).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('reads the refresh token from the cookie, rotates it, and re-sets the cookie', async () => {
    authServiceMock.refresh.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE]: 'old-refresh' },
    } as unknown as Request;

    const result = await controller.refresh(req, res);

    expect(authServiceMock.refresh).toHaveBeenCalledWith('old-refresh');
    expect(result).toEqual({ accessToken: 'new-access' });
    expect(cookieMock).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'new-refresh',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('rejects a refresh request with no cookie and never calls the service', async () => {
    const req = { cookies: {} } as unknown as Request;

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authServiceMock.refresh).not.toHaveBeenCalled();
  });

  it('returns the authenticated user from the access-token payload on /me', () => {
    const payload: JwtPayload = { sub: 'user-id', role: UserRole.USER };

    expect(controller.me(payload)).toEqual({
      userId: 'user-id',
      role: UserRole.USER,
    });
  });
});
