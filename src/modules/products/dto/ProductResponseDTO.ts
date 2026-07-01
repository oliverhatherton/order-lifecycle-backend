import { ApiProperty } from '@nestjs/swagger';
import type { ProductEntity } from '@/entities/product/ProductEntity';

/** Public view of a product returned by the catalog endpoint. */
export class ProductResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  sku: string;

  @ApiProperty({ description: 'Units currently available to reserve.' })
  stock: number;
}

export function toProductResponseDTO(
  product: ProductEntity,
): ProductResponseDTO {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
  };
}
