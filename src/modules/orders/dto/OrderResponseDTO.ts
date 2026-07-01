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
    paymentInitiatedAt: order.paymentInitiatedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
