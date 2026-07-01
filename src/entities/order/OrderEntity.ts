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
import { OrderStatus } from '@/entities/order/OrderStatus';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';

/**
 * An order owned by a user, tracked through its lifecycle states. Always
 * originates from a checked-out cart (see CartService) — its `items` are a
 * snapshot of the cart's line items at checkout time.
 */
@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Indexed: orders are looked up and listed by owner.
  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  // Native Postgres enum. The initializer guarantees `create()` yields a
  // PENDING order without relying on a DB round-trip.
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus = OrderStatus.PENDING;

  // Set the instant the caller confirms payment on a RESERVED order (see
  // OrdersService.initiatePayment). Doubles as an idempotency guard: the
  // atomic claim UPDATE only succeeds while this is NULL, so a double-click
  // on "Pay" can't fire the payment event twice.
  @Column({ type: 'timestamptz', nullable: true })
  paymentInitiatedAt: Date | null = null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
