import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetricEventsAndPaymentInitiatedAt1782907200000 implements MigrationInterface {
  name = 'AddMetricEventsAndPaymentInitiatedAt1782907200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "metric_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "metric" character varying NOT NULL, "value" double precision NOT NULL, "labels" jsonb, "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_metric_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_metric_events_metric_recordedAt" ON "metric_events" ("metric", "recordedAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "paymentInitiatedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "paymentInitiatedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_metric_events_metric_recordedAt"`,
    );
    await queryRunner.query(`DROP TABLE "metric_events"`);
  }
}
