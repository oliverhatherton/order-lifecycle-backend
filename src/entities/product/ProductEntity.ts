import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A sellable item with a real stock count. Reservation (InventoryConsumer)
 * atomically decrements `stock`; cancelling a RESERVED order or a rollback
 * on insufficient stock atomically restores it. Seeded on boot (see
 * SeedService) — insert-if-missing by `sku`, so a redeploy never resets
 * stock a running instance has already depleted.
 *
 * `active` retires a product from the shop without deleting it: past order
 * items reference products with ON DELETE RESTRICT, so a catalog change
 * hides the old rows instead of breaking order history.
 */
@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  sku: string;

  @Column({ type: 'int' })
  stock: number;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
