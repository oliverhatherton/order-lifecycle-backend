import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';

/**
 * A user's shopping basket. `checkedOutAt` doubles as a one-shot claim (same
 * pattern as OrderEntity.paymentInitiatedAt): a cart can only be checked out
 * while it's NULL, and the atomic claim UPDATE in CartService.checkout means
 * a cart can never be checked out twice, even under a concurrent double
 * click. A user has at most one *open* cart at a time — CartService creates
 * one lazily on first use; once checked out, the next cart action starts a
 * fresh one, so a cart is single-use by construction.
 */
@Entity('carts')
export class CartEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Column({ type: 'timestamptz', nullable: true })
  checkedOutAt: Date | null = null;

  @OneToMany(() => CartItemEntity, (item) => item.cart, { cascade: true })
  items?: CartItemEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
