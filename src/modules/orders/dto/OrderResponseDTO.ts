import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@/entities/order/OrderStatus';
import type { OrderEntity } from '@/entities/order/OrderEntity';

/** Public view of an order returned by the orders endpoints. */
export class OrderResponseDTO {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Owner of the order.' })
  userId: string;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.PENDING })
  status: OrderStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** Maps an {@link OrderEntity} to its response shape. */
export function toOrderResponseDTO(order: OrderEntity): OrderResponseDTO {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
