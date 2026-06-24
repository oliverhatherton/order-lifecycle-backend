import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from '@/modules/auth/controllers/auth.controller';
import { AdminUserController } from '@/modules/auth/controllers/admin-user.controller';
import { AuthService } from '@/modules/auth/services/auth.service';
import { TokenService } from '@/modules/auth/services/token.service';
import { UserService } from '@/modules/auth/services/user.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { RolesGuard } from '@/modules/auth/guards/RolesGuard';
import { UserEntity } from '@/entities/user/UserEntity';
import { RefreshTokenEntity } from '@/entities/refresh-token/RefreshTokenEntity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>(
            'jwt.accessExpiresIn',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, AdminUserController],
  providers: [AuthService, TokenService, UserService, JwtAuthGuard, RolesGuard],
  // Exported so other feature modules (e.g. OrdersModule) can guard their
  // routes with JwtAuthGuard. JwtModule is re-exported so the guard's
  // JwtService dependency resolves in the importing module.
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
