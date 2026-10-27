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
 * click. A user has at most one *open* cart at a time — enforced by a
 * partial unique index, so two concurrent first requests can't each create
 * one (CartService re-reads the winner's cart). Once checked out, the next
 * cart action starts a fresh one, so a cart is single-use by construction.
 */
@Entity('carts')
@Index('UQ_carts_open_per_user', ['userId'], {
  unique: true,
  where: '"checkedOutAt" IS NULL',
})
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
