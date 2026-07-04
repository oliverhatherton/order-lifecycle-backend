import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';

/**
 * Server-side record of an issued refresh token. Only the SHA-256 hash of the
 * token is stored, so a database leak does not expose usable tokens.
 * `familyId` groups every token descended from one login via rotation, so
 * reuse detection can revoke one session without logging the user out
 * everywhere (see TokenService.rotate).
 */
@Entity('refresh_tokens')
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  // Indexed: reuse detection revokes by family.
  @Index()
  @Column('uuid')
  familyId: string;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean = false;

  @CreateDateColumn()
  createdAt: Date;
}
