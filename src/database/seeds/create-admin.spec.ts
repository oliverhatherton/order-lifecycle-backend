import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { seedAdmin } from '@/database/seeds/create-admin';
import { UserEntity } from '@/entities/user/UserEntity';
import { UserRole } from '@/entities/user/UserRole';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('seedAdmin', () => {
  const repositoryMock = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  // Silent logger so the test output stays clean.
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  function run(credentials: { email: string; password: string }) {
    return seedAdmin(repositoryMock as never, credentials, logger);
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an ADMIN with a normalised email and hashed password', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    repositoryMock.findOneBy.mockResolvedValue(null);
    repositoryMock.create.mockImplementation(
      (value: Partial<UserEntity>) => value,
    );
    repositoryMock.save.mockImplementation((value: UserEntity) =>
      Promise.resolve(UserEntityMother.create(value)),
    );

    const result = await run({
      email: 'Ops@Example.com',
      password: 'SecurePass123!',
    });

    expect(result).toBe('created');
    expect(bcrypt.hash).toHaveBeenCalledWith('SecurePass123!', 10);
    expect(repositoryMock.findOneBy).toHaveBeenCalledWith({
      email: 'ops@example.com',
    });
    expect(repositoryMock.create).toHaveBeenCalledWith({
      email: 'ops@example.com',
      password: 'hashed-password',
      role: UserRole.ADMIN,
    });
    expect(repositoryMock.save).toHaveBeenCalled();
  });

  it('is idempotent: leaves an existing user untouched', async () => {
    repositoryMock.findOneBy.mockResolvedValue(
      UserEntityMother.create({ email: 'ops@example.com' }),
    );

    const result = await run({
      email: 'ops@example.com',
      password: 'SecurePass123!',
    });

    expect(result).toBe('exists');
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(repositoryMock.save).not.toHaveBeenCalled();
  });
});
