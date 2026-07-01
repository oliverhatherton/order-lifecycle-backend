import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@/entities/order/OrderStatus';
import type { OrderEntity } from '@/entities/order/OrderEntity';
import type { OrderItemEntity } from '@/entities/order/OrderItemEntity';

/** A line item on an order, as returned to the caller. */
export class OrderItemResponseDTO {
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ description: "Snapshot of the product's name at order time." })
  productName: string;

  @ApiProperty()
  quantity: number;
}

/** Public view of an order returned by the orders endpoints. */
export class OrderResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Owner of the order.' })
  userId: string;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PENDING })
  status: OrderStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the caller confirmed payment (POST /orders/{id}/pay). Null while ' +
      'RESERVED and awaiting payment; set once payment has been triggered, ' +
      'even if the order later fails.',
  })
  paymentInitiatedAt: Date | null;

  @ApiProperty({ type: [OrderItemResponseDTO] })
  items: OrderItemResponseDTO[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

function toOrderItemResponseDTO(item: OrderItemEntity): OrderItemResponseDTO {
  return {
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
  };
}

/** Maps an {@link OrderEntity} to its response shape. */
export function toOrderResponseDTO(order: OrderEntity): OrderResponseDTO {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    paymentInitiatedAt: order.paymentInitiatedAt,
    items: (order.items ?? []).map(toOrderItemResponseDTO),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
