import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentAuthorizationClaim1782940000000 implements MigrationInterface {
  name = 'PaymentAuthorizationClaim1782940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NULL = claimed, charge in flight (see PaymentGateway.authorize).
    await queryRunner.query(
      `ALTER TABLE "payment_authorizations" ALTER COLUMN "authorized" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "payment_authorizations" WHERE "authorized" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_authorizations" ALTER COLUMN "authorized" SET NOT NULL`,
    );
  }
}
