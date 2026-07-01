import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { EventPublisher } from '@/modules/messaging/event-publisher';
import { CacheService } from '@/modules/cache/cache.service';
import { OrderRoutingKey } from '@/modules/messaging/events/order-events';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { OrderEntityMother } from '@/entities/order/mother/OrderEntityMother';

describe('OrdersService', () => {
  let service: OrdersService;

  const queryBuilderMock = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn(),
  };

  const repositoryMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  const publisherMock = {
    publish: jest.fn(),
  };

  const cacheMock = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    queryBuilderMock.update.mockReturnValue(queryBuilderMock);
    queryBuilderMock.set.mockReturnValue(queryBuilderMock);
    queryBuilderMock.where.mockReturnValue(queryBuilderMock);
    queryBuilderMock.andWhere.mockReturnValue(queryBuilderMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: repositoryMock,
        },
        {
          provide: EventPublisher,
          useValue: publisherMock,
        },
        {
          provide: CacheService,
          useValue: cacheMock,
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 60 },
        },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('creates, persists, and announces a PENDING order owned by the user', async () => {
      const created = OrderEntityMother.create({ userId: 'user-1' });
      repositoryMock.create.mockReturnValue(created);
      repositoryMock.save.mockResolvedValue(created);
      publisherMock.publish.mockResolvedValue(undefined);

      const result = await service.createOrder('user-1');

      expect(repositoryMock.create).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(repositoryMock.save).toHaveBeenCalledWith(created);
      expect(publisherMock.publish).toHaveBeenCalledWith(
        OrderRoutingKey.Created,
        expect.objectContaining({ orderId: created.id, userId: 'user-1' }),
      );
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.userId).toBe('user-1');
    });

    it("invalidates the owner's cached order list", async () => {
      const created = OrderEntityMother.create({ userId: 'user-1' });
      repositoryMock.create.mockReturnValue(created);
      repositoryMock.save.mockResolvedValue(created);
      publisherMock.publish.mockResolvedValue(undefined);

      await service.createOrder('user-1');

      expect(cacheMock.del).toHaveBeenCalledWith('orders:user:user-1');
    });

    it('still returns the saved order if publishing fails (publish-after-commit)', async () => {
      const created = OrderEntityMother.create({ userId: 'user-1' });
      repositoryMock.create.mockReturnValue(created);
      repositoryMock.save.mockResolvedValue(created);
      publisherMock.publish.mockRejectedValue(new Error('broker down'));

      const result = await service.createOrder('user-1');

      expect(result).toBe(created);
    });
  });

  describe('listOrdersForUser', () => {
    it("returns the user's orders most recent first and caches them on a miss", async () => {
      const orders = [OrderEntityMother.create({ userId: 'user-1' })];
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.find.mockResolvedValue(orders);

      const result = await service.listOrdersForUser('user-1');

      expect(repositoryMock.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe(orders);
      expect(cacheMock.set).toHaveBeenCalledWith(
        'orders:user:user-1',
        orders,
        60,
      );
    });

    it('serves the list from cache without hitting the database', async () => {
      const cached = [OrderEntityMother.create({ userId: 'user-1' })];
      cacheMock.get.mockResolvedValue(cached);

      const result = await service.listOrdersForUser('user-1');

      expect(repositoryMock.find).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe('getOrderForUser', () => {
    it('returns an order the user owns', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
      });
      repositoryMock.findOneBy.mockResolvedValue(order);

      const result = await service.getOrderForUser('order-1', 'user-1');

      expect(repositoryMock.findOneBy).toHaveBeenCalledWith({
        id: 'order-1',
        userId: 'user-1',
      });
      expect(result).toBe(order);
    });

    it('caches the order on a miss so the next read can be served from Redis', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
      });
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(order);

      await service.getOrderForUser('order-1', 'user-1');

      expect(cacheMock.set).toHaveBeenCalledWith('order:order-1', order, 60);
    });

    it('serves an owned order from cache without hitting the database', async () => {
      const cached = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
      });
      cacheMock.get.mockResolvedValue(cached);

      const result = await service.getOrderForUser('order-1', 'user-1');

      expect(repositoryMock.findOneBy).not.toHaveBeenCalled();
      expect(result.id).toBe('order-1');
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('ignores a cached order owned by someone else and falls through to the DB', async () => {
      const cached = OrderEntityMother.create({
        id: 'order-1',
        userId: 'other-user',
      });
      cacheMock.get.mockResolvedValue(cached);
      repositoryMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.getOrderForUser('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repositoryMock.findOneBy).toHaveBeenCalledWith({
        id: 'order-1',
        userId: 'user-1',
      });
    });

    it('throws NotFoundException when the order is missing or not owned', async () => {
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.getOrderForUser('order-1', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('transitionOrder', () => {
    it('applies and persists a legal transition', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        status: OrderStatus.PENDING,
      });
      repositoryMock.findOneBy.mockResolvedValue(order);
      repositoryMock.save.mockImplementation((value: OrderEntity) =>
        Promise.resolve(value),
      );

      const result = await service.transitionOrder(
        'order-1',
        OrderStatus.RESERVED,
      );

      expect(result.status).toBe(OrderStatus.RESERVED);
      expect(repositoryMock.save).toHaveBeenCalledWith(order);
    });

    it('invalidates the cached order and the owner list after a transition', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PENDING,
      });
      repositoryMock.findOneBy.mockResolvedValue(order);
      repositoryMock.save.mockImplementation((value: OrderEntity) =>
        Promise.resolve(value),
      );

      await service.transitionOrder('order-1', OrderStatus.RESERVED);

      expect(cacheMock.del).toHaveBeenCalledWith(
        'order:order-1',
        'orders:user:user-1',
      );
    });

    it('rejects an illegal transition with ConflictException and does not persist', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        status: OrderStatus.PENDING,
      });
      repositoryMock.findOneBy.mockResolvedValue(order);

      await expect(
        service.transitionOrder('order-1', OrderStatus.PAID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('rejects any transition out of a terminal state', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        status: OrderStatus.COMPLETED,
      });
      repositoryMock.findOneBy.mockResolvedValue(order);

      await expect(
        service.transitionOrder('order-1', OrderStatus.PENDING),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the order does not exist', async () => {
      repositoryMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.transitionOrder('missing', OrderStatus.RESERVED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('initiatePayment', () => {
    it('claims a RESERVED order and publishes the payment-confirmed event', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.RESERVED,
      });
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(order);
      queryBuilderMock.execute.mockResolvedValue({ affected: 1 });
      publisherMock.publish.mockResolvedValue(undefined);

      const result = await service.initiatePayment('order-1', 'user-1');

      expect(queryBuilderMock.where).toHaveBeenCalledWith('id = :id', {
        id: 'order-1',
      });
      expect(publisherMock.publish).toHaveBeenCalledWith(
        OrderRoutingKey.InventoryReserved,
        expect.objectContaining({ orderId: 'order-1', userId: 'user-1' }),
      );
      expect(result.paymentInitiatedAt).toBeInstanceOf(Date);
      expect(cacheMock.del).toHaveBeenCalledWith('order:order-1');
    });

    it('throws ConflictException without claiming when the order is not RESERVED', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.PENDING,
      });
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(order);

      await expect(
        service.initiatePayment('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(queryBuilderMock.execute).not.toHaveBeenCalled();
      expect(publisherMock.publish).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a concurrent claim already won (affected 0)', async () => {
      const order = OrderEntityMother.create({
        id: 'order-1',
        userId: 'user-1',
        status: OrderStatus.RESERVED,
      });
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(order);
      queryBuilderMock.execute.mockResolvedValue({ affected: 0 });

      await expect(
        service.initiatePayment('order-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(publisherMock.publish).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an order the caller does not own', async () => {
      cacheMock.get.mockResolvedValue(undefined);
      repositoryMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.initiatePayment('order-1', 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(queryBuilderMock.execute).not.toHaveBeenCalled();
    });
  });
});
