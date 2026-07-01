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
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
@ApiTags('admin')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'List all users (metadata only)' })
  @ApiOkResponse({
    type: [UserResponseDTO],
    description: 'All users, passwords never included.',
  })
  async list(): Promise<UserResponseDTO[]> {
    const users = await this.userService.listUsers();
    return users.map(toUserResponseDTO);
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a user (blocks login and refresh)' })
  @ApiOkResponse({ type: UserResponseDTO, description: 'The disabled user.' })
  @ApiNotFoundResponse({ description: 'No such user' })
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDTO> {
    return toUserResponseDTO(await this.userService.disableUser(id));
  }

  @Patch(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-enable a previously disabled user' })
  @ApiOkResponse({ type: UserResponseDTO, description: 'The re-enabled user.' })
  @ApiNotFoundResponse({ description: 'No such user' })
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDTO> {
    return toUserResponseDTO(await this.userService.enableUser(id));
  }
}
