import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CartEntity } from '@/entities/cart/CartEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';

/**
 * A line item in a cart. Unique on (cartId, productId): adding a product
 * already in the cart is an upsert (set quantity), not a second row.
 */
@Entity('cart_items')
@Unique(['cartId', 'productId'])
export class CartItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  cartId: string;

  @ManyToOne(() => CartEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' })
  cart?: CartEntity;

  @Column()
  productId: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product?: ProductEntity;

  @Column({ type: 'int' })
  quantity: number;
}
