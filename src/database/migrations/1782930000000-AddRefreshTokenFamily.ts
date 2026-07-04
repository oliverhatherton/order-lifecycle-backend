import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenFamily1782930000000 implements MigrationInterface {
  name = 'AddRefreshTokenFamily1782930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing tokens predate families: each becomes its own single-token
    // family, so the default fills them in and is then dropped — new rows
    // always get their family from TokenService.
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "familyId" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_familyId" ON "refresh_tokens" ("familyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_refresh_tokens_familyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "familyId"`,
    );
  }
}
