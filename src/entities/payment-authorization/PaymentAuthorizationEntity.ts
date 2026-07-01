import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The payment provider's idempotency ledger: one authorization decision per
 * order. The `orderId` primary key is the idempotency key — a repeated
 * authorization for the same order returns the stored decision instead of
 * charging again, mirroring a real PSP's `Idempotency-Key` behaviour. Durable
 * (Postgres) so the guarantee survives a restart, consistent with the inbox.
 */
@Entity('payment_authorizations')
export class PaymentAuthorizationEntity {
  /** Idempotency key — one authorization per order. */
  @PrimaryColumn()
  orderId: string;

  @Column()
  authorized: boolean;

  @Column({ type: 'varchar', nullable: true })
  declineReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
