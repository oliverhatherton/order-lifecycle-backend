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
  recordTerminalState,
  timeDb,
} from '@/modules/metrics/metrics.collectors';
import {
  InventoryReservedEvent,
  OrderCreatedEvent,
  OrderRoutingKey,
} from '@/modules/messaging/events/order-events';

/** Cache key for a single order by id. */
const orderKey = (id: string): string => `order:${id}`;

/** Cache key for a user's full order list. */
const userOrdersKey = (userId: string): string => `orders:user:${userId}`;

/** Terminal statuses map to the `orders_terminal_total` metric's state label. */
const TERMINAL_STATE_LABELS: Partial<
  Record<OrderStatus, 'completed' | 'failed'>
> = {
  [OrderStatus.COMPLETED]: 'completed',
  [OrderStatus.FAILED]: 'failed',
};

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
    const order = await timeDb('order.create', () =>
      this.orderRepository.save(this.orderRepository.create({ userId })),
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

    // The new order changes the owner's list, so drop its cached copy.
    await this.cache.del(userOrdersKey(userId));

    return order;
  }

  /**
   * Lists the user's own orders, most recent first. Cache-aside on
   * `orders:user:{userId}`; the key is invalidated whenever the user's set of
   * orders changes (create / transition).
   */
  async listOrdersForUser(userId: string): Promise<OrderEntity[]> {
    const key = userOrdersKey(userId);
    const cached = await this.cache.get<OrderEntity[]>(key);
    if (cached) {
      return cached.map(rehydrateOrder);
    }

    const orders = await timeDb('orders.list', () =>
      this.orderRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      }),
    );

    await this.cache.set(key, orders, this.cacheTtl);
    return orders;
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

    const order = await timeDb('order.find', () =>
      this.orderRepository.findOneBy({ id, userId }),
    );
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

    const order = await timeDb('order.find', () =>
      repository.findOneBy({ id: orderId }),
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const from = order.status;
    if (!isTransitionAllowed(from, to)) {
      throw new ConflictException(`Illegal order transition: ${from} -> ${to}`);
    }

    order.status = to;
    const saved = await timeDb('order.update', () => repository.save(order));
    this.logger.log(`Order ${orderId} transitioned ${from} -> ${to}`);

    // A terminal status is a business outcome worth a dedicated counter so a
    // failure spike is detectable independently of the per-consumer metrics.
    const terminalLabel = TERMINAL_STATE_LABELS[to];
    if (terminalLabel) {
      recordTerminalState(terminalLabel);
    }

    // Write-through invalidation: drop the by-id entry and the owner's list (a
    // status change alters both) so the next read repopulates with the new
    // status (TTL is only the backstop).
    await this.cache.del(orderKey(orderId), userOrdersKey(order.userId));

    return saved;
  }

  /**
   * Confirms payment on a RESERVED order the user owns — the "Pay" button in
   * the UI. Inventory reservation no longer auto-advances the order; it sits
   * in RESERVED until this is called, then publishes the same event
   * PaymentConsumer already listens for, resuming the async chain
   * (authorize → PAID/FAILED → COMPLETED).
   *
   * The status/claim check is a single atomic `UPDATE ... WHERE status =
   * RESERVED AND paymentInitiatedAt IS NULL`, so two concurrent calls (e.g. a
   * double-click) can only ever have one publish the event — the loser sees
   * `affected === 0` and gets a 409, not a duplicate payment attempt.
   */
  async initiatePayment(orderId: string, userId: string): Promise<OrderEntity> {
    // 404s if the order doesn't exist or isn't the caller's.
    const order = await this.getOrderForUser(orderId, userId);
    if (order.status !== OrderStatus.RESERVED) {
      throw new ConflictException(
        `Order is not awaiting payment (status: ${order.status})`,
      );
    }

    const claim = await timeDb('order.claimPayment', () =>
      this.orderRepository
        .createQueryBuilder()
        .update(OrderEntity)
        .set({ paymentInitiatedAt: () => 'now()' })
        .where('id = :id', { id: orderId })
        .andWhere('status = :status', { status: OrderStatus.RESERVED })
        .andWhere('"paymentInitiatedAt" IS NULL')
        .execute(),
    );
    if (claim.affected === 0) {
      throw new ConflictException(
        'Payment has already been initiated for this order',
      );
    }
    order.paymentInitiatedAt = new Date();

    // Publish-after-claim, same fail-open policy as createOrder: the claim is
    // durable even if the broker is briefly unavailable, at the cost of a
    // stuck order needing reconciliation (no outbox yet).
    const event: InventoryReservedEvent = {
      orderId: order.id,
      userId: order.userId,
      occurredAt: new Date().toISOString(),
    };
    try {
      await this.eventPublisher.publish(
        OrderRoutingKey.InventoryReserved,
        event,
      );
      this.logger.log(`Payment confirmed by caller for order ${order.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish payment-confirmed event for order ${order.id}`,
        error as Error,
      );
    }

    await this.cache.del(orderKey(orderId));
    return order;
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
