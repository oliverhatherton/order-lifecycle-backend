import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartsProductsOrderItemsAndCancelled1782910000000
  implements MigrationInterface
{
  name = 'AddCartsProductsOrderItemsAndCancelled1782910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."orders_status_enum" ADD VALUE 'CANCELLED'`);

    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "sku" character varying NOT NULL, "stock" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_products_sku" UNIQUE ("sku"), CONSTRAINT "PK_products_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "carts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "checkedOutAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_carts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_carts_userId" ON "carts" ("userId")`);
    await queryRunner.query(
      `ALTER TABLE "carts" ADD CONSTRAINT "FK_carts_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "cart_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cartId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "UQ_cart_items_cartId_productId" UNIQUE ("cartId", "productId"), CONSTRAINT "PK_cart_items_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_cart_items_cartId" ON "cart_items" ("cartId")`);
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_cart_items_cartId" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_cart_items_productId" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "productId" uuid NOT NULL, "productName" character varying NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "PK_order_items_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_order_items_orderId" ON "order_items" ("orderId")`);
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_order_items_orderId" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_order_items_productId" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_order_items_productId"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_order_items_orderId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_items_orderId"`);
    await queryRunner.query(`DROP TABLE "order_items"`);

    await queryRunner.query(`ALTER TABLE "cart_items" DROP CONSTRAINT "FK_cart_items_productId"`);
    await queryRunner.query(`ALTER TABLE "cart_items" DROP CONSTRAINT "FK_cart_items_cartId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_cartId"`);
    await queryRunner.query(`DROP TABLE "cart_items"`);

    await queryRunner.query(`ALTER TABLE "carts" DROP CONSTRAINT "FK_carts_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_carts_userId"`);
    await queryRunner.query(`DROP TABLE "carts"`);

    await queryRunner.query(`DROP TABLE "products"`);

    // Postgres has no ALTER TYPE ... DROP VALUE; a rollback that must remove
    // CANCELLED would need to recreate the enum type. Not needed here.
  }
}
