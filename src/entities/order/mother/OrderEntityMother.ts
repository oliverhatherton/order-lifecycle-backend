import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';

/**
 * Object Mother for {@link OrderEntity}. Returns a persisted-looking PENDING
 * order by default; pass overrides to vary individual fields.
 */
export class OrderEntityMother {
  static create(overrides: Partial<OrderEntity> = {}): OrderEntity {
    const order = new OrderEntity();
    order.id = 'order-uuid';
    order.userId = 'user-uuid';
    order.status = OrderStatus.PENDING;
    order.createdAt = new Date('2026-01-01T00:00:00.000Z');
    order.updatedAt = new Date('2026-01-01T00:00:00.000Z');
    return Object.assign(order, overrides);
  }
}
