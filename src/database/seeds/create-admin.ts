import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '@/app.module';
import { UserEntity } from '@/entities/user/UserEntity';
import { UserRole } from '@/entities/user/UserRole';
import { BCRYPT_SALT_ROUNDS } from '@/modules/auth/auth.constants';
import { normalizeEmail } from '@/common/utils/normalize-email';

export type SeedAdminResult = 'created' | 'exists';

/**
 * Idempotently ensures an ADMIN user exists for the given credentials. Pure
 * persistence logic, decoupled from the process/env/bootstrap concerns so it
 * can be unit tested. Never trusts client input: the email is normalised and
 * the password bcrypt-hashed before storage.
 */
export async function seedAdmin(
  repository: Repository<UserEntity>,
  credentials: { email: string; password: string },
  logger: Logger = new Logger('CreateAdmin'),
): Promise<SeedAdminResult> {
  const email = normalizeEmail(credentials.email);

  const existing = await repository.findOneBy({ email });
  if (existing) {
    logger.warn(`User ${email} already exists; leaving it unchanged.`);
    return 'exists';
  }

  const admin = repository.create({
    email,
    password: await bcrypt.hash(credentials.password, BCRYPT_SALT_ROUNDS),
    role: UserRole.ADMIN,
  });
  const saved = await repository.save(admin);

  logger.log(`Created admin user ${email} (${saved.id}).`);
  return 'created';
}

/**
 * Out-of-band admin bootstrap. Run by an operator with database access:
 *
 *   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='…' pnpm admin:create
 *
 * Deliberately has no HTTP surface. Reads credentials from the environment and
 * delegates the persistence to {@link seedAdmin}.
 */
async function createAdmin(): Promise<void> {
  const logger = new Logger('CreateAdmin');

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    logger.error(
      'ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const repository = app.get(DataSource).getRepository(UserEntity);
    await seedAdmin(repository, { email, password }, logger);
  } catch (error) {
    logger.error('Failed to create admin user', error as Error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only run the bootstrap when executed directly (e.g. `pnpm admin:create`),
// so the module can be imported in tests without side effects.
if (require.main === module) {
  void createAdmin();
}
