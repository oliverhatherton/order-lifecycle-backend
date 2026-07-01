import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';

/**
 * An order owned by a user, tracked through its lifecycle states. Epic 2 keeps
 * this deliberately minimal — owner, status and timestamps — with line-items
 * and amounts deferred until a later story needs them.
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
