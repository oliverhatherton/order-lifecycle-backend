import { Test, TestingModule } from '@nestjs/testing';
import { AdminUserController } from '@/modules/auth/controllers/admin-user.controller';
import { UserService } from '@/modules/auth/services/user.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { RolesGuard } from '@/modules/auth/guards/RolesGuard';
import { UserEntityMother } from '@/entities/user/mother/UserEntityMother';
import { UserRole } from '@/entities/user/UserRole';

describe('AdminUserController', () => {
  let controller: AdminUserController;

  const userServiceMock = {
    listUsers: jest.fn(),
    disableUser: jest.fn(),
    enableUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUserController],
      providers: [{ provide: UserService, useValue: userServiceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminUserController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lists users as password-free metadata', async () => {
    const user = UserEntityMother.create({ role: UserRole.ADMIN });
    userServiceMock.listUsers.mockResolvedValue([user]);

    const result = await controller.list();

    expect(result).toEqual([
      {
        id: user.id,
        email: user.email,
        role: user.role,
        disabled: user.disabled,
        createdAt: user.createdAt,
      },
    ]);
    expect(result[0]).not.toHaveProperty('password');
  });

  it('disables a user and returns the updated metadata', async () => {
    const user = UserEntityMother.create({ disabled: true });
    userServiceMock.disableUser.mockResolvedValue(user);

    const result = await controller.disable(user.id);

    expect(userServiceMock.disableUser).toHaveBeenCalledWith(user.id);
    expect(result.disabled).toBe(true);
    expect(result).not.toHaveProperty('password');
  });

  it('enables a user and returns the updated metadata', async () => {
    const user = UserEntityMother.create({ disabled: false });
    userServiceMock.enableUser.mockResolvedValue(user);

    const result = await controller.enable(user.id);

    expect(userServiceMock.enableUser).toHaveBeenCalledWith(user.id);
    expect(result.disabled).toBe(false);
  });
});
