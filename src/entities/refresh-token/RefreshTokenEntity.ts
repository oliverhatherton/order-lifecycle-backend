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
 * token is stored, so a database leak does not expose usable tokens. The
 * `revoked` flag and `expiresAt` exist to support revocation/expiry checks in
 * later stories.
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
