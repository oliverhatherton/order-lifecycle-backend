import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { ProductEntity } from '@/entities/product/ProductEntity';
import {
  InsufficientStockError,
  ProductsService,
} from '@/modules/products/products.service';

describe('ProductsService', () => {
  let service: ProductsService;

  const queryBuilderMock = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameter: jest.fn(),
    execute: jest.fn(),
  };

  const repositoryMock = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  const managerRepositoryMock = {
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  const managerMock = {
    getRepository: jest.fn(() => managerRepositoryMock),
  } as unknown as EntityManager;

  beforeEach(async () => {
    queryBuilderMock.update.mockReturnValue(queryBuilderMock);
    queryBuilderMock.set.mockReturnValue(queryBuilderMock);
    queryBuilderMock.where.mockReturnValue(queryBuilderMock);
    queryBuilderMock.andWhere.mockReturnValue(queryBuilderMock);
    queryBuilderMock.setParameter.mockReturnValue(queryBuilderMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(ProductEntity),
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('reserveStock', () => {
    it('decrements every line atomically when all have enough stock', async () => {
      queryBuilderMock.execute.mockResolvedValue({ affected: 1 });

      await service.reserveStock(
        [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 3 },
        ],
        managerMock,
      );

      expect(queryBuilderMock.execute).toHaveBeenCalledTimes(2);
    });

    it('throws InsufficientStockError and restores lines already decremented for this call', async () => {
      // p1 succeeds, p2 is short.
      queryBuilderMock.execute
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.reserveStock(
          [
            { productId: 'p1', quantity: 2 },
            { productId: 'p2', quantity: 100 },
          ],
          managerMock,
        ),
      ).rejects.toThrow(InsufficientStockError);

      // 2 attempts (p1 decrement, p2 short-decrement) + 1 compensating
      // restore for p1 = 3 total calls to the query builder's execute.
      expect(queryBuilderMock.execute).toHaveBeenCalledTimes(3);
    });

    it('does not attempt to restore anything when the very first line is short', async () => {
      queryBuilderMock.execute.mockResolvedValue({ affected: 0 });

      await expect(
        service.reserveStock([{ productId: 'p1', quantity: 5 }], managerMock),
      ).rejects.toThrow(InsufficientStockError);

      expect(queryBuilderMock.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoreStock', () => {
    it('increments every line back', async () => {
      queryBuilderMock.execute.mockResolvedValue({ affected: 1 });

      await service.restoreStock([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 3 },
      ]);

      expect(queryBuilderMock.execute).toHaveBeenCalledTimes(2);
      expect(repositoryMock.createQueryBuilder).toHaveBeenCalled();
    });

    it('uses the given manager when provided, not the injected repository', async () => {
      queryBuilderMock.execute.mockResolvedValue({ affected: 1 });
      repositoryMock.createQueryBuilder.mockClear();

      await service.restoreStock(
        [{ productId: 'p1', quantity: 1 }],
        managerMock,
      );

      expect(repositoryMock.createQueryBuilder).not.toHaveBeenCalled();
      expect(managerRepositoryMock.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('list / findByIds', () => {
    it('lists products alphabetically', async () => {
      repositoryMock.find.mockResolvedValue([]);
      await service.list();
      expect(repositoryMock.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
    });

    it('returns an empty array without querying when given no ids', async () => {
      const result = await service.findByIds([]);
      expect(result).toEqual([]);
    });
  });
});
