import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { CartService } from '@/modules/cart/cart.service';
import { ProductsService } from '@/modules/products/products.service';
import { OrdersService } from '@/modules/orders/services/orders.service';

describe('CartService', () => {
  let service: CartService;

  const queryBuilderMock = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn(),
  };

  const cartRepositoryMock = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((data: object) => ({ id: 'cart-1', items: [], ...data })),
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  const cartItemRepositoryMock = {
    upsert: jest.fn(),
    delete: jest.fn(),
  };

  const productsMock = { findByIds: jest.fn() };
  const ordersMock = { createOrder: jest.fn() };

  beforeEach(async () => {
    queryBuilderMock.update.mockReturnValue(queryBuilderMock);
    queryBuilderMock.set.mockReturnValue(queryBuilderMock);
    queryBuilderMock.where.mockReturnValue(queryBuilderMock);
    queryBuilderMock.andWhere.mockReturnValue(queryBuilderMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: getRepositoryToken(CartEntity), useValue: cartRepositoryMock },
        {
          provide: getRepositoryToken(CartItemEntity),
          useValue: cartItemRepositoryMock,
        },
        { provide: ProductsService, useValue: productsMock },
        { provide: OrdersService, useValue: ordersMock },
      ],
    }).compile();

    service = module.get(CartService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOpenCart', () => {
    it('returns the existing open cart', async () => {
      const cart = { id: 'cart-1', userId: 'user-1', items: [] };
      cartRepositoryMock.findOne.mockResolvedValue(cart);

      const result = await service.getOpenCart('user-1');

      expect(result).toBe(cart);
      expect(cartRepositoryMock.save).not.toHaveBeenCalled();
    });

    it('creates a fresh cart when none is open', async () => {
      cartRepositoryMock.findOne.mockResolvedValue(null);
      cartRepositoryMock.save.mockImplementation((c: object) =>
        Promise.resolve(c),
      );

      const result = await service.getOpenCart('user-1');

      expect(cartRepositoryMock.create).toHaveBeenCalledWith({
        userId: 'user-1',
      });
      expect(result.items).toEqual([]);
    });
  });

  describe('setItem', () => {
    it('404s when the product does not exist', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [],
      });
      productsMock.findByIds.mockResolvedValue([]);

      await expect(
        service.setItem('user-1', 'missing-product', 2),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartItemRepositoryMock.upsert).not.toHaveBeenCalled();
    });

    it('upserts the line item on the open cart', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [],
      });
      productsMock.findByIds.mockResolvedValue([{ id: 'product-1' }]);

      await service.setItem('user-1', 'product-1', 4);

      expect(cartItemRepositoryMock.upsert).toHaveBeenCalledWith(
        { cartId: 'cart-1', productId: 'product-1', quantity: 4 },
        ['cartId', 'productId'],
      );
    });
  });

  describe('removeItem', () => {
    it('deletes the line item scoped to the open cart', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [],
      });

      await service.removeItem('user-1', 'product-1');

      expect(cartItemRepositoryMock.delete).toHaveBeenCalledWith({
        cartId: 'cart-1',
        productId: 'product-1',
      });
    });
  });

  describe('checkout', () => {
    it('rejects an empty cart with 409 and never claims it', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [],
      });

      await expect(service.checkout('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(queryBuilderMock.execute).not.toHaveBeenCalled();
    });

    it('claims the cart and creates the order from its line items', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [
          {
            productId: 'product-1',
            quantity: 2,
            product: { name: 'Widget' },
          },
        ],
      });
      queryBuilderMock.execute.mockResolvedValue({ affected: 1 });
      ordersMock.createOrder.mockResolvedValue({ id: 'order-1' });

      const result = await service.checkout('user-1');

      expect(ordersMock.createOrder).toHaveBeenCalledWith('user-1', [
        { productId: 'product-1', productName: 'Widget', quantity: 2 },
      ]);
      expect(result).toEqual({ id: 'order-1' });
    });

    it('rejects with 409 when a concurrent checkout already claimed it (double-click guard)', async () => {
      cartRepositoryMock.findOne.mockResolvedValue({
        id: 'cart-1',
        userId: 'user-1',
        items: [{ productId: 'product-1', quantity: 1, product: { name: 'Widget' } }],
      });
      queryBuilderMock.execute.mockResolvedValue({ affected: 0 });

      await expect(service.checkout('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(ordersMock.createOrder).not.toHaveBeenCalled();
    });
  });
});
