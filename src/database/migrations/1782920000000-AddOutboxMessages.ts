import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxMessages1782920000000 implements MigrationInterface {
  name = 'AddOutboxMessages1782920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox_messages" ("id" uuid NOT NULL, "exchange" character varying NOT NULL, "routingKey" character varying NOT NULL, "payload" jsonb NOT NULL, "correlationId" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "publishedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_outbox_messages_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_messages_publishedAt_createdAt" ON "outbox_messages" ("publishedAt", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_outbox_messages_publishedAt_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "outbox_messages"`);
  }
}
