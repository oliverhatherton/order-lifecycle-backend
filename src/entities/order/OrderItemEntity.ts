import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';

/**
 * A line item on an order — product + quantity, snapshotted from the cart at
 * checkout. `productName` is a copy, not a live join: a product renamed or
 * removed later must not rewrite an order's history.
 */
@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column()
  productId: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: ProductEntity;

  /** Snapshot of the product's name at order time. */
  @Column()
  productName: string;

  @Column({ type: 'int' })
  quantity: number;
}
