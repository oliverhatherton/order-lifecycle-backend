import { MigrationInterface, QueryRunner } from 'typeorm';

export class OneOpenCartPerUser1782960000000 implements MigrationInterface {
  name = 'OneOpenCartPerUser1782960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Before the index can exist, collapse any duplicate open carts the old
    // lazy-create race left behind: keep each user's newest, drop the rest
    // (their items cascade). Open carts are transient, so nothing of record
    // is lost; checked-out carts are untouched.
    await queryRunner.query(
      `DELETE FROM "carts" c
       USING "carts" newer
       WHERE c."userId" = newer."userId"
         AND c."checkedOutAt" IS NULL AND newer."checkedOutAt" IS NULL
         AND (c."createdAt", c."id") < (newer."createdAt", newer."id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_carts_open_per_user" ON "carts" ("userId") WHERE "checkedOutAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_carts_open_per_user"`);
  }
}
