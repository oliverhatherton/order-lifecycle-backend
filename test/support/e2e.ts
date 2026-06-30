import {
  INestApplication,
  InjectionToken,
  ModuleMetadata,
} from '@nestjs/common';
import { ConfigModule, ConfigFactory } from '@nestjs/config';
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
import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { buildValidationPipe } from '@/common/validation/validation-pipe';
import { RegisterDTOMother } from '@/modules/auth/dto/RegisterDTOMother';
import { LoginDTOMother } from '@/modules/auth/dto/LoginDTOMother';
import { AccessTokenResponseDTO } from '@/modules/auth/dto/AccessTokenResponseDTO';
import { REFRESH_TOKEN_COOKIE } from '@/modules/auth/auth.constants';
import { CacheModule } from '@/modules/cache/cache.module';
import { REDIS_CLIENT } from '@/modules/cache/redis.provider';
import { correlationClsModule } from '@/common/correlation/correlation';
import jwtConfig from '@/config/jwt.config';
import rabbitmqConfig from '@/config/rabbitmq.config';
import redisConfig from '@/config/redis.config';
import { createFakeRedis } from '@test/support/fake-redis';

export interface TestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  container: StartedPostgreSqlContainer;
  rabbitContainer?: StartedRabbitMQContainer;
  redisContainer?: StartedRedisContainer;
}

export interface StartTestAppOptions {
  /** Entities to register against the throwaway Postgres container. */
  entities: EntityClassOrSchema[];
  /** Feature modules under test (e.g. AuthModule, OrdersModule). */
  imports: NonNullable<ModuleMetadata['imports']>;
  /** Start a RabbitMQ container and point the messaging config at it. */
  rabbitmq?: boolean;
  /**
   * Start a real Redis container so cache behaviour (hits, invalidation) can be
   * asserted. Off by default: suites that only need the app to boot get an
   * in-memory fake Redis instead, avoiding an extra container per suite.
   */
  redis?: boolean;
  /** Replace providers with test doubles (e.g. force a payment outcome). */
  overrides?: Array<{ provide: InjectionToken; useValue: unknown }>;
}

/**
 * Boots a real Nest app backed by a fresh Postgres testcontainer (and, when
 * `rabbitmq` is set, a RabbitMQ one), wired the same way as production
 * (cookie-parser + the global ValidationPipe). Shared by every e2e suite so the
 * bootstrap lives in one place.
 */
export async function startTestApp(
  options: StartTestAppOptions,
): Promise<TestApp> {
  const container = await new PostgreSqlContainer('postgres:16').start();

  // redisConfig is always loaded so the global CacheModule's DI resolves; the
  // client is either a real container (redis: true) or an in-memory fake.
  const load: ConfigFactory[] = [jwtConfig, redisConfig];
  const overrides = [...(options.overrides ?? [])];

  let rabbitContainer: StartedRabbitMQContainer | undefined;
  if (options.rabbitmq) {
    rabbitContainer = await new RabbitMQContainer('rabbitmq:4').start();
    // rabbitmqConfig reads this at factory time.
    process.env.RABBITMQ_URL = rabbitContainer.getAmqpUrl();
    load.push(rabbitmqConfig);
  }

  let redisContainer: StartedRedisContainer | undefined;
  if (options.redis) {
    redisContainer = await new RedisContainer('redis:7').start();
    // redisConfig reads this at factory time.
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
  } else {
    overrides.push({ provide: REDIS_CLIENT, useValue: createFakeRedis() });
  }

  let builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load }),
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
      // Global cache infra — provides CacheService to the feature modules
      // (the real app wires this via AppModule).
      CacheModule,
      // Correlation-id CLS (middleware + ClsService) — the app wires this in
      // AppModule; feature modules and consumers depend on ClsService.
      correlationClsModule(),
      ...options.imports,
    ],
  });
  for (const override of overrides) {
    builder = builder
      .overrideProvider(override.provide)
      .useValue(override.useValue);
  }
  const moduleFixture = await builder.compile();

  const app: INestApplication<App> = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(buildValidationPipe());
  await app.init();

  return {
    app,
    dataSource: moduleFixture.get(DataSource),
    container,
    rabbitContainer,
    redisContainer,
  };
}

/** Tears down the app and its container(s); null-safe if startup failed. */
export async function stopTestApp(testApp?: TestApp): Promise<void> {
  await testApp?.app.close();
  await testApp?.container.stop();
  await testApp?.rabbitContainer?.stop();
  await testApp?.redisContainer?.stop();
}

export interface E2eContext {
  readonly app: INestApplication<App>;
  readonly dataSource: DataSource;
}

export interface SetupE2eTestOptions extends StartTestAppOptions {
  /** Tables truncated (CASCADE) before each test to isolate cases. */
  truncate?: string[];
}

/**
 * Registers the whole e2e lifecycle for a describe block: boots a
 * containerized app in `beforeAll`, tears it down in `afterAll`, and truncates
 * the given tables before each test. Returns a context whose `app`/`dataSource`
 * are live by the time the tests run, so a suite never repeats the bootstrap.
 *
 * Call it once at the top of a `describe`:
 *
 *   const ctx = setupE2eTest({ entities: [...], imports: [...], truncate: [...] });
 *   // then use ctx.app / ctx.dataSource inside the tests
 */
export function setupE2eTest(options: SetupE2eTestOptions): E2eContext {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp(options);
  });

  afterAll(async () => {
    await stopTestApp(testApp);
  });

  const tables = options.truncate ?? [];
  if (tables.length > 0) {
    const truncateSql = `TRUNCATE TABLE ${tables
      .map((table) => `"${table}"`)
      .join(', ')} CASCADE`;
    beforeEach(async () => {
      await testApp.dataSource.query(truncateSql);
    });
  }

  return {
    get app() {
      return testApp.app;
    },
    get dataSource() {
      return testApp.dataSource;
    },
  };
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

/** Polls `predicate` until it is true or the timeout elapses (for async flows). */
export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  {
    timeoutMs = 10000,
    intervalMs = 50,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor: condition not met within timeout');
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
