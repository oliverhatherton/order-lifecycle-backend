import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from '@/modules/auth/services/user.service';
import { UserEntity } from '@/entities/user/UserEntity';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';

describe('UserService', () => {
  let service: UserService;

  const repositoryMock = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lists users in registration order', async () => {
    const users = [UserEntityMother.create()];
    repositoryMock.find.mockResolvedValue(users);

    const result = await service.listUsers();

    expect(repositoryMock.find).toHaveBeenCalledWith({
      order: { createdAt: 'ASC' },
    });
    expect(result).toBe(users);
  });

  it('disables a user and persists the change', async () => {
    const user = UserEntityMother.create({ disabled: false });
    repositoryMock.findOneBy.mockResolvedValue(user);
    repositoryMock.save.mockImplementation((value: UserEntity) =>
      Promise.resolve(value),
    );

    const result = await service.disableUser(user.id);

    expect(result.disabled).toBe(true);
    expect(repositoryMock.save).toHaveBeenCalledWith(user);
  });

  it('enables a previously disabled user', async () => {
    const user = UserEntityMother.create({ disabled: true });
    repositoryMock.findOneBy.mockResolvedValue(user);
    repositoryMock.save.mockImplementation((value: UserEntity) =>
      Promise.resolve(value),
    );

    const result = await service.enableUser(user.id);

    expect(result.disabled).toBe(false);
  });

  it('throws NotFoundException when disabling an unknown user', async () => {
    repositoryMock.findOneBy.mockResolvedValue(null);

    await expect(service.disableUser('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repositoryMock.save).not.toHaveBeenCalled();
  });
});
