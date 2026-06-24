import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from '@/modules/orders/controllers/orders.controller';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { OrderEntityMother } from '@/entities/order/mother/OrderEntityMother';
import { OrderStatus } from '@/entities/order/OrderStatus';
import { UserRole } from '@/entities/user/UserRole';
import type { JwtPayload } from '@/modules/auth/types/JwtPayload';

describe('OrdersController', () => {
  let controller: OrdersController;

  const ordersServiceMock = {
    createOrder: jest.fn(),
    listOrdersForUser: jest.fn(),
    getOrderForUser: jest.fn(),
  };

  const caller: JwtPayload = { sub: 'user-1', role: UserRole.USER };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: ordersServiceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrdersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an order for the authenticated caller and returns its metadata', async () => {
    const order = OrderEntityMother.create({ userId: caller.sub });
    ordersServiceMock.createOrder.mockResolvedValue(order);

    const result = await controller.create(caller);

    expect(ordersServiceMock.createOrder).toHaveBeenCalledWith(caller.sub);
    expect(result).toEqual({
      id: order.id,
      userId: order.userId,
      status: OrderStatus.PENDING,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  });

  it("lists the caller's own orders as response metadata", async () => {
    const order = OrderEntityMother.create({ userId: caller.sub });
    ordersServiceMock.listOrdersForUser.mockResolvedValue([order]);

    const result = await controller.list(caller);

    expect(ordersServiceMock.listOrdersForUser).toHaveBeenCalledWith(
      caller.sub,
    );
    expect(result).toEqual([
      {
        id: order.id,
        userId: order.userId,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    ]);
  });

  it('fetches an order scoped to the caller', async () => {
    const order = OrderEntityMother.create({
      id: 'order-1',
      userId: caller.sub,
    });
    ordersServiceMock.getOrderForUser.mockResolvedValue(order);

    const result = await controller.getById('order-1', caller);

    expect(ordersServiceMock.getOrderForUser).toHaveBeenCalledWith(
      'order-1',
      caller.sub,
    );
    expect(result.id).toBe('order-1');
  });
});
