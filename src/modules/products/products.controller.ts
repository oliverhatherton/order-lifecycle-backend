import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import {
  ProductResponseDTO,
  toProductResponseDTO,
} from '@/modules/products/dto/ProductResponseDTO';
import { ProductsService } from '@/modules/products/products.service';

@ApiTags('products')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the product catalog',
    description:
      'Seeded on boot (see SeedService); `stock` is live and may change ' +
      'between reads as other orders reserve or cancel.',
  })
  @ApiOkResponse({ type: [ProductResponseDTO] })
  async list(): Promise<ProductResponseDTO[]> {
    const products = await this.products.list();
    return products.map(toProductResponseDTO);
  }
}
