import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';

/** Administrative user-management operations: listing and enabling/disabling. */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  /** Returns every user in registration order. */
  listUsers(): Promise<UserEntity[]> {
    return this.userRepository.find({ order: { createdAt: 'ASC' } });
  }

  /** Disables a user so they can no longer authenticate or refresh tokens. */
  disableUser(id: string): Promise<UserEntity> {
    return this.setDisabled(id, true);
  }

  /** Re-enables a previously disabled user. */
  enableUser(id: string): Promise<UserEntity> {
    return this.setDisabled(id, false);
  }

  private async setDisabled(
    id: string,
    disabled: boolean,
  ): Promise<UserEntity> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.disabled = disabled;
    const saved = await this.userRepository.save(user);
    this.logger.log(`User ${saved.id} ${disabled ? 'disabled' : 'enabled'}`);
    return saved;
  }
}
