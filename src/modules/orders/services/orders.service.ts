import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EntityManager, Repository } from 'typeorm';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { isTransitionAllowed } from '@/modules/orders/order-state-machine';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { CacheService } from '@/modules/cache/cache.service';
import {
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

/** Cache key for a single order by id. */
const orderKey = (id: string): string => `order:${id}`;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    private readonly eventPublisher: EventPublisher,
    private readonly cache: CacheService,
    configService: ConfigService,
  ) {
    this.cacheTtl = configService.getOrThrow<number>('redis.ttlSeconds');
  }

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
   *
   * Cache-aside on `order:{id}`: the by-id cache stores the owner, so a hit is
   * only served when it belongs to the caller — otherwise we fall through to the
   * (owner-scoped) DB lookup, which 404s. This keeps the by-id cache from ever
   * leaking an order across users.
   */
  async getOrderForUser(id: string, userId: string): Promise<OrderEntity> {
    const cached = await this.cache.get<OrderEntity>(orderKey(id));
    if (cached && cached.userId === userId) {
      return rehydrateOrder(cached);
    }

    const order = await this.orderRepository.findOneBy({ id, userId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.cache.set(orderKey(id), order, this.cacheTtl);
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

    // Write-through invalidation: drop the by-id entry so the next read
    // repopulates with the new status (TTL is only the backstop).
    await this.cache.del(orderKey(orderId));

    return saved;
  }
}

/**
 * Rebuilds a cached order into a real entity: JSON round-tripping turns the
 * timestamps into strings, so restore them to `Date` to honour the OrderEntity
 * contract for any caller that does more than serialise them back out.
 */
function rehydrateOrder(cached: OrderEntity): OrderEntity {
  return {
    ...cached,
    createdAt: new Date(cached.createdAt),
    updatedAt: new Date(cached.updatedAt),
  };
}
