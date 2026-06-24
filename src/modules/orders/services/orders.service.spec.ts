import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { OrderEntityMother } from '@/entities/order/mother/OrderEntityMother';

describe('OrdersService', () => {
  let service: OrdersService;

  const repositoryMock = {
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('creates and persists a PENDING order owned by the user', async () => {
      const created = OrderEntityMother.create({ userId: 'user-1' });
      repositoryMock.create.mockReturnValue(created);
      repositoryMock.save.mockResolvedValue(created);

      const result = await service.createOrder('user-1');

      expect(repositoryMock.create).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(repositoryMock.save).toHaveBeenCalledWith(created);
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.userId).toBe('user-1');
    });
  });

  describe('listOrdersForUser', () => {
    it("returns the user's orders most recent first", async () => {
      const orders = [OrderEntityMother.create({ userId: 'user-1' })];
      repositoryMock.find.mockResolvedValue(orders);

      const result = await service.listOrdersForUser('user-1');

      expect(repositoryMock.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe(orders);
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

    it('throws NotFoundException when the order is missing or not owned', async () => {
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
});
