import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { isTransitionAllowed } from '@/modules/orders/order-state-machine';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
  ) {}

  /** Creates a new PENDING order owned by the given user. */
  async createOrder(userId: string): Promise<OrderEntity> {
    const order = await this.orderRepository.save(
      this.orderRepository.create({ userId }),
    );
    this.logger.log(`Created order ${order.id} for user ${userId}`);
    return order;
  }

  /** Lists the user's own orders, most recent first. */
  listOrdersForUser(userId: string): Promise<OrderEntity[]> {
    return this.orderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Fetches an order the user owns. Scoping the lookup to the owner means
   * another user's order is indistinguishable from a missing one — both 404.
   */
  async getOrderForUser(id: string, userId: string): Promise<OrderEntity> {
    const order = await this.orderRepository.findOneBy({ id, userId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Advances an order to a new status if the order state machine permits the
   * transition, persisting the change. Illegal transitions are rejected and the
   * order is left untouched. System-level (not user-scoped) — Epic 3's events
   * drive it by order id.
   */
  async transitionOrder(
    orderId: string,
    to: OrderStatus,
  ): Promise<OrderEntity> {
    const order = await this.orderRepository.findOneBy({ id: orderId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const from = order.status;
    if (!isTransitionAllowed(from, to)) {
      throw new ConflictException(`Illegal order transition: ${from} -> ${to}`);
    }

    order.status = to;
    const saved = await this.orderRepository.save(order);
    this.logger.log(`Order ${orderId} transitioned ${from} -> ${to}`);
    return saved;
  }
}
