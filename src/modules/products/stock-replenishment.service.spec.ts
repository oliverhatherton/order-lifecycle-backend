import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { StockReplenishmentService } from '@/modules/products/stock-replenishment.service';

describe('StockReplenishmentService', () => {
  let service: StockReplenishmentService;
  let randomSpy: jest.SpyInstance;

  const queryBuilderMock = {
    where: jest.fn(),
    getMany: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    setParameter: jest.fn(),
    execute: jest.fn(),
  };

  const repositoryMock = {
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  beforeEach(async () => {
    queryBuilderMock.where.mockReturnValue(queryBuilderMock);
    queryBuilderMock.update.mockReturnValue(queryBuilderMock);
    queryBuilderMock.set.mockReturnValue(queryBuilderMock);
    queryBuilderMock.setParameter.mockReturnValue(queryBuilderMock);
    queryBuilderMock.execute.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockReplenishmentService,
        {
          provide: getRepositoryToken(ProductEntity),
          useValue: repositoryMock,
        },
      ],
    }).compile();

    service = module.get(StockReplenishmentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    randomSpy?.mockRestore();
  });

  function product(stock: number) {
    return { id: `p-${stock}`, name: `Product ${stock}`, stock };
  }

  it('always restocks at or below the guaranteed floor (stock 5)', async () => {
    queryBuilderMock.getMany.mockResolvedValue([product(5)]);
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9999); // would fail any probabilistic roll

    await service.replenishLowStock();

    expect(queryBuilderMock.execute).toHaveBeenCalledTimes(1);
  });

  it('never restocks above the threshold (stock 11)', async () => {
    queryBuilderMock.getMany.mockResolvedValue([]);
    // The query itself filters stock <= 10, so an 11 never even comes back —
    // proven by asserting the WHERE clause uses the threshold.
    await service.replenishLowStock();

    expect(queryBuilderMock.where).toHaveBeenCalledWith(
      'product.stock <= :threshold',
      { threshold: 10 },
    );
    expect(queryBuilderMock.execute).not.toHaveBeenCalled();
  });

  it('restocks stock=6 when the roll beats its ~83% probability', async () => {
    queryBuilderMock.getMany.mockResolvedValue([product(6)]);
    // probability at stock=6 is (11-6)/6 = 5/6 ≈ 0.833; a roll of 0.5 is a hit.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    await service.replenishLowStock();

    expect(queryBuilderMock.execute).toHaveBeenCalledTimes(1);
  });

  it('skips stock=10 when the roll misses its ~17% probability', async () => {
    queryBuilderMock.getMany.mockResolvedValue([product(10)]);
    // probability at stock=10 is (11-10)/6 = 1/6 ≈ 0.167; a roll of 0.5 misses.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    await service.replenishLowStock();

    expect(queryBuilderMock.execute).not.toHaveBeenCalled();
  });

  it('tops up by a random amount within [50, 100]', async () => {
    queryBuilderMock.getMany.mockResolvedValue([product(5)]);
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.replenishLowStock();

    expect(queryBuilderMock.setParameter).toHaveBeenCalledWith('amount', 50);
  });
});
