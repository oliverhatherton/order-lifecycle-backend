import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { buildValidationPipe } from '@/common/validation/validation-pipe';
import { RegisterDTOMother } from '@/modules/auth/dto/RegisterDTOMother';
import { LoginDTOMother } from '@/modules/auth/dto/LoginDTOMother';
import { AccessTokenResponseDTO } from '@/modules/auth/dto/AccessTokenResponseDTO';
import { REFRESH_TOKEN_COOKIE } from '@/modules/auth/auth.constants';
import jwtConfig from '@/config/jwt.config';

export interface TestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  container: StartedPostgreSqlContainer;
}

export interface StartTestAppOptions {
  /** Entities to register against the throwaway Postgres container. */
  entities: EntityClassOrSchema[];
  /** Feature modules under test (e.g. AuthModule, OrdersModule). */
  imports: NonNullable<ModuleMetadata['imports']>;
}

/**
 * Boots a real Nest app backed by a fresh Postgres testcontainer, wired the
 * same way as production (cookie-parser + the global ValidationPipe). Shared by
 * every e2e suite so the bootstrap lives in one place.
 */
export async function startTestApp(
  options: StartTestAppOptions,
): Promise<TestApp> {
  const container = await new PostgreSqlContainer('postgres:16').start();

  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [jwtConfig] }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: container.getHost(),
        port: container.getPort(),
        username: container.getUsername(),
        password: container.getPassword(),
        database: container.getDatabase(),
        entities: options.entities,
        synchronize: true,
      }),
      ...options.imports,
    ],
  }).compile();

  const app: INestApplication<App> = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(buildValidationPipe());
  await app.init();

  return { app, dataSource: moduleFixture.get(DataSource), container };
}

/** Tears down the app and its container. */
export async function stopTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.container.stop();
}

/** Registers a user and logs them in, returning the access token. */
export async function registerAndLogin(
  app: INestApplication<App>,
  overrides: Partial<{ email: string; password: string }> = {},
): Promise<string> {
  await request(app.getHttpServer())
    .post('/auth/register')
    .send(RegisterDTOMother.valid(overrides))
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send(LoginDTOMother.valid(overrides))
    .expect(200);
  return (login.body as AccessTokenResponseDTO).accessToken;
}

/** Pulls the raw refresh-token value out of a response's Set-Cookie header. */
export function extractRefreshCookie(response: request.Response): string {
  const setCookie = (response.headers['set-cookie'] ??
    []) as unknown as string[];
  const cookie = setCookie.find((value) =>
    value.startsWith(`${REFRESH_TOKEN_COOKIE}=`),
  );
  if (!cookie) {
    throw new Error('refresh token cookie was not set');
  }
  return cookie.split(';')[0].split('=')[1];
}
