import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  UserResponseDTO,
  toUserResponseDTO,
} from '@/modules/auth/dto/UserResponseDTO';
import { UserService } from '@/modules/auth/services/user.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { RolesGuard } from '@/modules/auth/guards/RolesGuard';
import { Roles } from '@/modules/auth/decorators/Roles';
import { UserRole } from '@/entities/user/UserRole';

// Every route here requires an authenticated ADMIN: JwtAuthGuard proves who the
// caller is, RolesGuard enforces the role declared by @Roles.
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async list(): Promise<UserResponseDTO[]> {
    const users = await this.userService.listUsers();
    return users.map(toUserResponseDTO);
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.OK)
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDTO> {
    return toUserResponseDTO(await this.userService.disableUser(id));
  }

  @Patch(':id/enable')
  @HttpCode(HttpStatus.OK)
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDTO> {
    return toUserResponseDTO(await this.userService.enableUser(id));
  }
}
