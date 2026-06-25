import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RegisterDTO } from '@/modules/auth/dto/RegisterDTO';
import { LoginDTO } from '@/modules/auth/dto/LoginDTO';
import {
  UserResponseDTO,
  toUserResponseDTO,
} from '@/modules/auth/dto/UserResponseDTO';
import type { AccessTokenResponseDTO } from '@/modules/auth/dto/AccessTokenResponseDTO';
import { AuthService } from '@/modules/auth/services/auth.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { RolesGuard } from '@/modules/auth/guards/RolesGuard';
import { Roles } from '@/modules/auth/decorators/Roles';
import { CurrentUser } from '@/modules/auth/decorators/CurrentUser';
import type { JwtPayload } from '@/modules/auth/types/JwtPayload';
import { UserRole } from '@/entities/user/UserRole';
import { REFRESH_TOKEN_COOKIE } from '@/modules/auth/auth.constants';
import { buildRefreshTokenCookieOptions } from '@/modules/auth/auth.cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(@Body() registerDTO: RegisterDTO): Promise<UserResponseDTO> {
    const user = await this.authService.register(registerDTO);
    return toUserResponseDTO(user);
  }

  @Post('/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in; returns an access token and sets the refresh cookie',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(
    @Body() loginDTO: LoginDTO,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDTO> {
    const { accessToken, refreshToken } =
      await this.authService.login(loginDTO);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Rotate the refresh-token cookie for a new access token',
  })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or reused token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDTO> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const presented = cookies?.[REFRESH_TOKEN_COOKIE];

    // No cookie is indistinguishable from an invalid one — same generic error.
    if (!presented) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { accessToken, refreshToken } =
      await this.authService.refresh(presented);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  // Protected resource open to any authenticated user (USER or, as a superset,
  // ADMIN) — demonstrates the role-aware guard at the authenticated tier.
  @Get('/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Identity of the authenticated user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  me(@CurrentUser() user: JwtPayload): { userId: string; role: string } {
    return { userId: user.sub, role: user.role };
  }

  /** Writes the rotated refresh token back as an httpOnly cookie. */
  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      refreshToken,
      buildRefreshTokenCookieOptions(this.configService),
    );
  }
}
