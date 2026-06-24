import type { OrderStatus } from '@/entities/order/OrderStatus';
import type { OrderEntity } from '@/entities/order/OrderEntity';

/** Public view of an order returned by the orders endpoints. */
export type OrderResponseDTO = {
  id: string;
  userId: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
};

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
