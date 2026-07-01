import { ApiProperty } from '@nestjs/swagger';
import type { CartEntity } from '@/entities/cart/CartEntity';

/** A cart line item, with the product's live name/stock joined in. */
export class CartItemResponseDTO {
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty({ description: "The product's current available stock." })
  productStock: number;

  @ApiProperty()
  quantity: number;
}

export class CartResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: [CartItemResponseDTO] })
  items: CartItemResponseDTO[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export function toCartResponseDTO(cart: CartEntity): CartResponseDTO {
  return {
    id: cart.id,
    items: (cart.items ?? []).map((item) => ({
      productId: item.productId,
      productName: item.product?.name ?? '',
      productStock: item.product?.stock ?? 0,
      quantity: item.quantity,
    })),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}
