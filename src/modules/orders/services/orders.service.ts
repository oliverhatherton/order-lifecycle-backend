import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderItemEntity } from '@/entities/order/OrderItemEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import {
  isTerminalStatus,
  isTransitionAllowed,
} from '@/modules/orders/order-state-machine';
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
import { ProductsService } from '@/modules/products/products.service';

/** A checked-out cart line, ready to become an OrderItem. */
export interface OrderLine {
  productId: string;
  productName: string;
  quantity: number;
}

/** Cache key for a single order by id. */
const orderKey = (id: string): string => `order:${id}`;

/** Cache key for a user's full order list. */
const userOrdersKey = (userId: string): string => `orders:user:${userId}`;

/** Terminal statuses map to the `orders_terminal_total` metric's state label. */
const TERMINAL_STATE_LABELS: Partial<
  Record<OrderStatus, 'completed' | 'failed' | 'cancelled'>
> = {
  [OrderStatus.COMPLETED]: 'completed',
  [OrderStatus.FAILED]: 'failed',
  [OrderStatus.CANCELLED]: 'cancelled',
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventPublisher: EventPublisher,
    private readonly cache: CacheService,
    private readonly products: ProductsService,
    configService: ConfigService,
  ) {
    this.cacheTtl = configService.getOrThrow<number>('redis.ttlSeconds');
  }

  /**
   * Creates a new PENDING order owned by the given user from a checked-out
   * cart's line items, and announces it. The order and its OrderItems are
   * persisted in one transaction — there's never a moment where the order
   * exists without its items.
   */
  async createOrder(userId: string, lines: OrderLine[]): Promise<OrderEntity> {
    const order = await timeDb('order.create', () =>
      this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(OrderEntity, { userId }),
        );
        const items = lines.map((line) =>
          manager.create(OrderItemEntity, {
            orderId: created.id,
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity,
          }),
        );
        created.items = await manager.save(items);
        return created;
      }),
    );
    this.logger.log(`Created order ${order.id} for user ${userId}`);

    // Publish-after-commit: the order is durably saved before we announce it.
    // If the broker is unavailable we log rather than fail the request (no
    // outbox yet); the order still exists and can be reconciled.
    const event: OrderCreatedEvent = {
      orderId: order.id,
      userId: order.userId,
      items: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
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
   *
   * Only cached when every order in the list is terminal (COMPLETED/FAILED).
   * A non-terminal order can transition (and invalidate) at any moment; if a
   * read racing a concurrent transition wrote its stale snapshot to the cache
   * *after* that transition's invalidating `del`, the stale entry would sit
   * there un-invalidated until the TTL — the "completed order still shows
   * PAID" bug. Terminal orders never transition again, so caching them has no
   * such race. See getOrderForUser for the same reasoning on the by-id cache.
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
        relations: { items: true },
        order: { createdAt: 'DESC' },
      }),
    );

    if (orders.every((order) => isTerminalStatus(order.status))) {
      await this.cache.set(key, orders, this.cacheTtl);
    }
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
   *
   * Only cached once the order is terminal (COMPLETED/FAILED) — see
   * listOrdersForUser's doc for why: caching a still-progressing order risks
   * a stale-write-after-invalidate race under concurrent polling + a
   * transition, which is exactly the bug where a completed order kept
   * reading back as PAID until the cache TTL expired. Skipping the cache for
   * non-terminal reads costs a few extra DB hits during the few seconds an
   * order is in flight; once terminal, caching is race-free (it will never
   * change again) so it's cached as before.
   */
  async getOrderForUser(id: string, userId: string): Promise<OrderEntity> {
    const cached = await this.cache.get<OrderEntity>(orderKey(id));
    if (cached && cached.userId === userId) {
      return rehydrateOrder(cached);
    }

    const order = await timeDb('order.find', () =>
      this.orderRepository.findOne({
        where: { id, userId },
        relations: { items: true },
      }),
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (isTerminalStatus(order.status)) {
      await this.cache.set(orderKey(id), order, this.cacheTtl);
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

    // Belt-and-braces: non-terminal orders are never cached in the first
    // place (see getOrderForUser), so this mainly matters the instant an
    // order *becomes* terminal — drop any pre-existing entries so the next
    // read repopulates fresh rather than serving something from before.
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

  /**
   * Cancels an order the user owns — allowed from PENDING, or from RESERVED
   * as long as payment hasn't been confirmed yet (`paymentInitiatedAt IS
   * NULL`; once "Pay" has been clicked, cancelling would race a payment
   * that might already be mid-flight, so it's blocked — that would need a
   * refund flow, out of scope). The atomic claim UPDATE folds both the
   * status and payment-confirmed checks into its WHERE clause, so it can't
   * lose a race against a concurrent `/pay` call: whichever request's claim
   * lands first wins, the other gets a 409.
   */
  async cancelOrder(orderId: string, userId: string): Promise<OrderEntity> {
    const order = await this.getOrderForUser(orderId, userId);
    const cancellable =
      order.status === OrderStatus.PENDING ||
      (order.status === OrderStatus.RESERVED &&
        order.paymentInitiatedAt === null);
    if (!cancellable) {
      throw new ConflictException(
        `Order cannot be cancelled (status: ${order.status})`,
      );
    }
    const wasReserved = order.status === OrderStatus.RESERVED;

    const claim = await timeDb('order.claimCancel', () =>
      this.orderRepository
        .createQueryBuilder()
        .update(OrderEntity)
        .set({ status: OrderStatus.CANCELLED })
        .where('id = :id', { id: orderId })
        .andWhere(
          '((status = :pending) OR (status = :reserved AND "paymentInitiatedAt" IS NULL))',
          { pending: OrderStatus.PENDING, reserved: OrderStatus.RESERVED },
        )
        .execute(),
    );
    if (claim.affected === 0) {
      throw new ConflictException('Order can no longer be cancelled');
    }

    // Stock was only actually decremented once the order reached RESERVED —
    // a PENDING cancel has nothing to give back.
    if (wasReserved) {
      const lines = (order.items ?? []).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }));
      await this.products.restoreStock(lines);
    }

    recordTerminalState('cancelled');
    this.logger.log(`Order ${orderId} cancelled by caller`);
    await this.cache.del(orderKey(orderId), userOrdersKey(order.userId));

    order.status = OrderStatus.CANCELLED;
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
