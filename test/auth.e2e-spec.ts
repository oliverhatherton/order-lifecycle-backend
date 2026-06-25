import request from 'supertest';
import { AuthModule } from '@/modules/auth/auth.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';
import { RegisterDTOMother } from '@/modules/auth/dto/RegisterDTOMother';
import { LoginDTOMother } from '@/modules/auth/dto/LoginDTOMother';
import { UserResponseDTO } from '@/modules/auth/dto/UserResponseDTO';
import { AccessTokenResponseDTO } from '@/modules/auth/dto/AccessTokenResponseDTO';
import { REFRESH_TOKEN_COOKIE } from '@/modules/auth/auth.constants';
import { UserRole } from '@/entities/user/UserRole';
import { extractRefreshCookie, setupE2eTest } from '@test/support/e2e';

describe('AuthController (e2e)', () => {
  const ctx = setupE2eTest({
    entities: [UserEntity, RefreshTokenEntity],
    imports: [AuthModule],
    // CASCADE clears refresh_tokens (FK -> users) too.
    truncate: ['refresh_tokens', 'users'],
  });

  async function registerUser(
    overrides: Partial<{ email: string; password: string }> = {},
  ): Promise<void> {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid(overrides))
      .expect(201);
  }

  it('POST /auth/register returns the created user metadata only', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid())
      .expect(201);

    const body = response.body as UserResponseDTO;
    expect(body).toMatchObject({ email: 'test@example.com' });
    expect(body.id).toBeDefined();
    expect(body.role).toBe(UserRole.USER);
    expect(body.disabled).toBe(false);
    expect(body.createdAt).toBeDefined();
    expect(body).not.toHaveProperty('password');
  });

  it('persists the user with a hashed password and default role', async () => {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid())
      .expect(201);

    const stored = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'test@example.com' });
    expect(stored.role).toBe(UserRole.USER);
    expect(stored.password).not.toBe('SecurePass123!');
  });

  it('POST /auth/register rejects duplicate emails with 409', async () => {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid({ email: 'duplicate@example.com' }))
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(
        RegisterDTOMother.valid({
          email: 'duplicate@example.com',
          password: 'AnotherPass456!',
        }),
      )
      .expect(409);
  });

  it('treats emails as unique case-insensitively', async () => {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid({ email: 'Person@Example.com' }))
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(
        RegisterDTOMother.valid({
          email: 'PERSON@example.COM',
          password: 'AnotherPass456!',
        }),
      )
      .expect(409);
  });

  it('stores and returns the email in canonical lowercase form', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid({ email: 'MixedCase@Example.com' }))
      .expect(201);

    const body = response.body as UserResponseDTO;
    expect(body.email).toBe('mixedcase@example.com');

    const stored = await ctx.dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'mixedcase@example.com' });
    expect(stored.email).toBe('mixedcase@example.com');
  });

  it('POST /auth/register rejects a weak password with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid({ password: 'weak' }))
      .expect(400);
  });

  it('POST /auth/register rejects an invalid email with 400', async () => {
    await request(ctx.app.getHttpServer())
      .post('/auth/register')
      .send(RegisterDTOMother.valid({ email: 'not-an-email' }))
      .expect(400);
  });

  describe('POST /auth/login', () => {
    it('returns the access token in the body and the refresh token as an httpOnly cookie', async () => {
      await registerUser();

      const response = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid())
        .expect(200);

      const body = response.body as AccessTokenResponseDTO;
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.length).toBeGreaterThan(0);
      // The refresh token is never exposed in the JSON body.
      expect(body).not.toHaveProperty('refreshToken');

      const setCookie = (response.headers['set-cookie'] ??
        []) as unknown as string[];
      const refreshCookie = setCookie.find((value) =>
        value.startsWith(`${REFRESH_TOKEN_COOKIE}=`),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
      expect(extractRefreshCookie(response).length).toBeGreaterThan(0);
    });

    it('logs in case-insensitively against the registered email', async () => {
      await registerUser({ email: 'Person@Example.com' });

      await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid({ email: 'PERSON@example.COM' }))
        .expect(200);
    });

    it('stores the refresh token server-side as a hash, not in plaintext', async () => {
      await registerUser();

      const response = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid())
        .expect(200);
      const refreshToken = extractRefreshCookie(response);

      const stored = await ctx.dataSource
        .getRepository(RefreshTokenEntity)
        .find();
      expect(stored).toHaveLength(1);
      expect(stored[0].tokenHash).not.toBe(refreshToken);
      expect(stored[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns the same generic error for unknown email and wrong password', async () => {
      await registerUser();

      const wrongPassword = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid({ password: 'WrongPass123!' }))
        .expect(401);

      const unknownEmail = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid({ email: 'nobody@example.com' }))
        .expect(401);

      expect(unknownEmail.body).toEqual(wrongPassword.body);
    });
  });

  describe('POST /auth/refresh', () => {
    /** Logs a fresh user in and returns their refresh-token cookie value. */
    async function loginUser(): Promise<string> {
      await registerUser();
      const login = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid())
        .expect(200);
      return extractRefreshCookie(login);
    }

    function refreshWith(token: string): request.Test {
      return request(ctx.app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${token}`);
    }

    it('rotates a valid refresh token into a fresh access token and new cookie', async () => {
      const refreshToken = await loginUser();

      const response = await refreshWith(refreshToken).expect(200);

      const body = response.body as AccessTokenResponseDTO;
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.length).toBeGreaterThan(0);
      // A new refresh token is issued in the cookie (rotation, not reuse).
      expect(extractRefreshCookie(response)).not.toBe(refreshToken);
    });

    it('lets the rotated access token reach a protected endpoint', async () => {
      const refreshToken = await loginUser();

      const refreshed = await refreshWith(refreshToken).expect(200);
      const { accessToken } = refreshed.body as AccessTokenResponseDTO;

      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('invalidates the old refresh token after rotation', async () => {
      const refreshToken = await loginUser();

      await refreshWith(refreshToken).expect(200);

      // The consumed token no longer works.
      await refreshWith(refreshToken).expect(401);
    });

    it('revokes the whole token family when a rotated token is reused', async () => {
      const refreshToken = await loginUser();

      const rotated = await refreshWith(refreshToken).expect(200);
      const newRefreshToken = extractRefreshCookie(rotated);

      // Replaying the already-rotated token is treated as theft...
      await refreshWith(refreshToken).expect(401);

      // ...and even the legitimately-issued successor is now revoked.
      await refreshWith(newRefreshToken).expect(401);
    });

    it('rejects an unknown refresh token with 401', async () => {
      await refreshWith('definitely-not-a-real-token').expect(401);
    });

    it('rejects an expired refresh token with 401', async () => {
      const refreshToken = await loginUser();

      // Force the stored (still-active) token to be expired.
      await ctx.dataSource
        .getRepository(RefreshTokenEntity)
        .update({ revoked: false }, { expiresAt: new Date(Date.now() - 1000) });

      await refreshWith(refreshToken).expect(401);
    });

    it('rejects a request with no refresh-token cookie with 401', async () => {
      await request(ctx.app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });

  describe('GET /auth/me (protected)', () => {
    it('accepts a valid access token and returns the user identity', async () => {
      await registerUser();
      const login = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid())
        .expect(200);
      const { accessToken } = login.body as AccessTokenResponseDTO;

      const response = await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ role: UserRole.USER });
      expect((response.body as { userId: string }).userId).toBeDefined();
    });

    it('rejects a request with no token', async () => {
      await request(ctx.app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects a request with a malformed token', async () => {
      await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });
  });

  describe('admin user management (RBAC)', () => {
    const ADMIN = { email: 'admin@example.com', password: 'SecurePass123!' };
    const MEMBER = { email: 'member@example.com', password: 'SecurePass123!' };

    /** Registers a user and returns their access token (USER role by default). */
    async function registerAndLogin(credentials: {
      email: string;
      password: string;
    }): Promise<string> {
      await registerUser(credentials);
      const login = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid(credentials))
        .expect(200);
      return (login.body as AccessTokenResponseDTO).accessToken;
    }

    /** Registers an admin (promoted directly in the DB) and returns its token. */
    async function loginAsAdmin(): Promise<string> {
      await registerUser(ADMIN);
      await ctx.dataSource
        .getRepository(UserEntity)
        .update({ email: ADMIN.email }, { role: UserRole.ADMIN });
      const login = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid(ADMIN))
        .expect(200);
      return (login.body as AccessTokenResponseDTO).accessToken;
    }

    async function userIdByEmail(email: string): Promise<string> {
      const user = await ctx.dataSource
        .getRepository(UserEntity)
        .findOneByOrFail({ email });
      return user.id;
    }

    it('lets an ADMIN list users as password-free metadata', async () => {
      const adminToken = await loginAsAdmin();
      await registerAndLogin(MEMBER);

      const response = await request(ctx.app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const users = response.body as Array<Record<string, unknown>>;
      expect(users).toHaveLength(2);
      for (const user of users) {
        expect(user).not.toHaveProperty('password');
        expect(user).toHaveProperty('disabled');
        expect(user).toHaveProperty('role');
      }
    });

    it('rejects a USER from the admin list with 403', async () => {
      const memberToken = await registerAndLogin(MEMBER);

      await request(ctx.app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('rejects an anonymous request to the admin list with 401', async () => {
      await request(ctx.app.getHttpServer()).get('/admin/users').expect(401);
    });

    it('rejects a USER attempting to disable another user with 403', async () => {
      const memberToken = await registerAndLogin(MEMBER);
      await registerUser(ADMIN);
      const targetId = await userIdByEmail(ADMIN.email);

      await request(ctx.app.getHttpServer())
        .patch(`/admin/users/${targetId}/disable`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('returns 404 when disabling an unknown user', async () => {
      const adminToken = await loginAsAdmin();

      await request(ctx.app.getHttpServer())
        .patch('/admin/users/00000000-0000-0000-0000-000000000000/disable')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('returns 400 for a malformed user id', async () => {
      const adminToken = await loginAsAdmin();

      await request(ctx.app.getHttpServer())
        .patch('/admin/users/not-a-uuid/disable')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('blocks login and refresh once a user is disabled, and restores them on enable', async () => {
      const adminToken = await loginAsAdmin();

      // The member logs in and obtains a refresh cookie.
      await registerUser(MEMBER);
      const memberLogin = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid(MEMBER))
        .expect(200);
      const refreshToken = extractRefreshCookie(memberLogin);
      const memberId = await userIdByEmail(MEMBER.email);

      // Admin disables the member.
      const disabled = await request(ctx.app.getHttpServer())
        .patch(`/admin/users/${memberId}/disable`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((disabled.body as { disabled: boolean }).disabled).toBe(true);

      // The disabled member can neither log in nor refresh.
      await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid(MEMBER))
        .expect(401);
      await request(ctx.app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${refreshToken}`)
        .expect(401);

      // Re-enabling restores access.
      const enabled = await request(ctx.app.getHttpServer())
        .patch(`/admin/users/${memberId}/enable`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((enabled.body as { disabled: boolean }).disabled).toBe(false);

      await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send(LoginDTOMother.valid(MEMBER))
        .expect(200);
    });
  });
});
