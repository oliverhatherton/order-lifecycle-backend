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
    listOrdersForUser: jest.fn(),
    getOrderForUser: jest.fn(),
    initiatePayment: jest.fn(),
    cancelOrder: jest.fn(),
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
        paymentInitiatedAt: null,
        items: [],
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

  it('confirms payment via the service and returns the (still RESERVED) order', async () => {
    const order = OrderEntityMother.create({
      id: 'order-1',
      userId: caller.sub,
      status: OrderStatus.RESERVED,
    });
    ordersServiceMock.initiatePayment.mockResolvedValue(order);

    const result = await controller.pay('order-1', caller);

    expect(ordersServiceMock.initiatePayment).toHaveBeenCalledWith(
      'order-1',
      caller.sub,
    );
    expect(result.id).toBe('order-1');
    expect(result.status).toBe(OrderStatus.RESERVED);
  });

  it('cancels via the service and returns the CANCELLED order', async () => {
    const order = OrderEntityMother.create({
      id: 'order-1',
      userId: caller.sub,
      status: OrderStatus.CANCELLED,
    });
    ordersServiceMock.cancelOrder.mockResolvedValue(order);

    const result = await controller.cancel('order-1', caller);

    expect(ordersServiceMock.cancelOrder).toHaveBeenCalledWith(
      'order-1',
      caller.sub,
    );
    expect(result.status).toBe(OrderStatus.CANCELLED);
  });
});
