import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { isTransitionAllowed } from '@/modules/orders/order-state-machine';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import {
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly eventPublisher: EventPublisher,
  ) {}

  /** Creates a new PENDING order owned by the given user and announces it. */
  async createOrder(userId: string): Promise<OrderEntity> {
    const order = await this.orderRepository.save(
      this.orderRepository.create({ userId }),
    );
    this.logger.log(`Created order ${order.id} for user ${userId}`);

    // Publish-after-commit: the order is durably saved before we announce it.
    // If the broker is unavailable we log rather than fail the request (no
    // outbox yet); the order still exists and can be reconciled.
    const event: OrderCreatedEvent = {
      orderId: order.id,
      userId: order.userId,
      occurredAt: order.createdAt.toISOString(),
    };
    try {
      await this.eventPublisher.publish(OrderRoutingKey.Created, event);
    } catch (error) {
      this.logger.error(
        `Failed to publish OrderCreated for order ${order.id}`,
        error as Error,
      );
    }

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
   * drive it by order id. Pass a transaction `manager` to run the transition
   * inside a consumer's idempotent transaction (see InboxService).
   */
  async transitionOrder(
    orderId: string,
    to: OrderStatus,
    manager?: EntityManager,
  ): Promise<OrderEntity> {
    const repository = manager
      ? manager.getRepository(OrderEntity)
      : this.orderRepository;

    const order = await repository.findOneBy({ id: orderId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const from = order.status;
    if (!isTransitionAllowed(from, to)) {
      throw new ConflictException(`Illegal order transition: ${from} -> ${to}`);
    }

    order.status = to;
    const saved = await repository.save(order);
    this.logger.log(`Order ${orderId} transitioned ${from} -> ${to}`);
    return saved;
  }
}
