import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserRole } from '@/entities/user/UserRole';
import { normalizeEmail } from '@/common/utils/normalize-email';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  // Canonicalise the email on every write so the unique constraint enforces
  // case-insensitive uniqueness across all persistence paths.
  @BeforeInsert()
  @BeforeUpdate()
  normalizeEmail(): void {
    if (this.email) {
      this.email = normalizeEmail(this.email);
    }
  }

  @Column()
  password: string;

  // Native Postgres enum column. The property initializer guarantees `create()`
  // produces an object already carrying the default role.
  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole = UserRole.USER;

  // Disabled users keep their record but can no longer authenticate or refresh.
  // Initializer mirrors the role default so `create()` yields an enabled user.
  @Column({ default: false })
  disabled: boolean = false;

  @CreateDateColumn()
  createdAt: Date;
}
