import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { SeedService } from '@/database/seeds/seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ProductEntity])],
  providers: [SeedService],
})
export class SeedModule {}
