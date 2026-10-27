import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductActive1782950000000 implements MigrationInterface {
  name = 'AddProductActive1782950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing products stay on sale; SeedService retires the old demo SKUs.
    await queryRunner.query(
      `ALTER TABLE "products" ADD "active" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "active"`);
  }
}
