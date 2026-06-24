import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { AuthService } from '@/modules/auth/services/auth.service';
import { TokenService } from '@/modules/auth/services/token.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { RegisterDTOMother } from '@/modules/auth/dto/RegisterDTOMother';
import { LoginDTOMother } from '@/modules/auth/dto/LoginDTOMother';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  const repositoryMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
  };

  const tokenServiceMock = {
    issueTokens: jest.fn(),
    rotate: jest.fn(),
  };

  const registerDTO = RegisterDTOMother.valid();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: repositoryMock,
        },
        {
          provide: TokenService,
          useValue: tokenServiceMock,
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('hashes the password before persisting the user', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    const createdUser = UserEntityMother.create({
      email: registerDTO.email,
      password: 'hashed-password',
    });
    repositoryMock.create.mockReturnValue(createdUser);
    repositoryMock.save.mockResolvedValue(createdUser);

    const result = await service.register(registerDTO);

    expect(bcrypt.hash).toHaveBeenCalledWith(registerDTO.password, 10);
    expect(repositoryMock.create).toHaveBeenCalledWith({
      email: registerDTO.email,
      password: 'hashed-password',
    });
    expect(repositoryMock.save).toHaveBeenCalledWith(createdUser);
    expect(result.password).not.toBe(registerDTO.password);
  });

  it('returns the saved user', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    const savedUser = UserEntityMother.create({ email: registerDTO.email });
    repositoryMock.create.mockReturnValue(savedUser);
    repositoryMock.save.mockResolvedValue(savedUser);

    const result = await service.register(registerDTO);

    expect(result).toEqual(savedUser);
  });

  it('throws ConflictException when the email already exists', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    repositoryMock.create.mockReturnValue(UserEntityMother.create());
    const uniqueViolation = new QueryFailedError('', [], {
      code: '23505',
    } as unknown as Error);
    repositoryMock.save.mockRejectedValue(uniqueViolation);

    await expect(service.register(registerDTO)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows non-unique-violation errors', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    repositoryMock.create.mockReturnValue(UserEntityMother.create());
    const dbError = new QueryFailedError('', [], {
      code: 'SOME_OTHER_ERROR',
    } as unknown as Error);
    repositoryMock.save.mockRejectedValue(dbError);

    await expect(service.register(registerDTO)).rejects.toBe(dbError);
  });

  describe('login', () => {
    const loginDTO = LoginDTOMother.valid();

    it('issues tokens when credentials are valid', async () => {
      const user = UserEntityMother.create({ email: loginDTO.email });
      repositoryMock.findOneBy.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const tokens = { accessToken: 'access', refreshToken: 'refresh' };
      tokenServiceMock.issueTokens.mockResolvedValue(tokens);

      const result = await service.login(loginDTO);

      expect(tokenServiceMock.issueTokens).toHaveBeenCalledWith(user);
      expect(result).toEqual(tokens);
    });

    it('looks the user up by normalized (lowercased) email', async () => {
      repositoryMock.findOneBy.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login(LoginDTOMother.valid({ email: 'Test@Example.com' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(repositoryMock.findOneBy).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
    });

    it('rejects an unknown email with a generic UnauthorizedException', async () => {
      repositoryMock.findOneBy.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDTO)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with the same generic error', async () => {
      repositoryMock.findOneBy.mockResolvedValue(
        UserEntityMother.create({ email: loginDTO.email }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDTO)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
    });

    it('still runs a bcrypt compare when the user is missing (no timing leak)', async () => {
      repositoryMock.findOneBy.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDTO)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('rejects a disabled user with the same generic error and issues no tokens', async () => {
      repositoryMock.findOneBy.mockResolvedValue(
        UserEntityMother.create({ email: loginDTO.email, disabled: true }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(loginDTO)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('delegates rotation to TokenService and returns the new tokens', async () => {
      const tokens = { accessToken: 'access', refreshToken: 'refresh' };
      tokenServiceMock.rotate.mockResolvedValue(tokens);

      const result = await service.refresh('old-refresh-token');

      expect(tokenServiceMock.rotate).toHaveBeenCalledWith('old-refresh-token');
      expect(result).toEqual(tokens);
    });
  });
});
