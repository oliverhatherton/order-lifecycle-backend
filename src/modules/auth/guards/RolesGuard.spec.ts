import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/modules/auth/guards/RolesGuard';
import { UserRole } from '@/entities/user/UserRole';

describe('RolesGuard', () => {
  let guard: RolesGuard;

  const reflectorMock = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(() => {
    guard = new RolesGuard(reflectorMock as unknown as Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function contextFor(user?: { role: UserRole }): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  it('allows the route when no roles are required', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(contextFor({ role: UserRole.USER }))).toBe(true);
  });

  it('allows a USER to reach a USER-tier route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.USER]);

    expect(guard.canActivate(contextFor({ role: UserRole.USER }))).toBe(true);
  });

  it('treats ADMIN as a superset of a USER-tier route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.USER]);

    expect(guard.canActivate(contextFor({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('allows an ADMIN to reach an ADMIN-only route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(contextFor({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('forbids a USER from an ADMIN-only route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() =>
      guard.canActivate(contextFor({ role: UserRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('forbids when a role is required but no user is present', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.USER]);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
