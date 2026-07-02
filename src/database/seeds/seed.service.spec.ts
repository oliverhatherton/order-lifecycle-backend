import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { SeedService } from '@/database/seeds/seed.service';

describe('SeedService', () => {
  let service: SeedService;

  const usersMock = {
    findOneBy: jest.fn(),
    create: jest.fn((data: object) => data),
    save: jest.fn(),
  };

  const productsMock = {
    find: jest.fn(),
    insert: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedService,
        { provide: getRepositoryToken(UserEntity), useValue: usersMock },
        { provide: getRepositoryToken(ProductEntity), useValue: productsMock },
      ],
    }).compile();

    service = module.get(SeedService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates the admin and seeds every product on a clean database', async () => {
    usersMock.findOneBy.mockResolvedValue(null);
    usersMock.save.mockResolvedValue({ id: 'admin-1' });
    productsMock.find.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    expect(usersMock.save).toHaveBeenCalledTimes(1);
    expect(productsMock.insert).toHaveBeenCalledTimes(1);
    const [inserted] = productsMock.insert.mock.calls[0] as [unknown[]];
    expect(inserted.length).toBeGreaterThan(0);
  });

  it('is idempotent: neither the admin nor already-seeded products are touched again', async () => {
    usersMock.findOneBy.mockResolvedValue({ id: 'admin-1' }); // already exists
    productsMock.find.mockResolvedValue(
      // Pretend every demo SKU already exists.
      Array.from({ length: 12 }, (_, i) => ({ sku: `EXISTING-${i}` })),
    );
    // Force an exact match by having `find` echo back the real seeded skus —
    // simulate by reading what the service would try to insert on an empty
    // DB first, then re-running as if those already exist.
    productsMock.find.mockResolvedValueOnce([]);
    await service.onApplicationBootstrap();
    const [insertedForSkus] = productsMock.insert.mock.calls[0] as [
      Array<{ sku: string }>,
    ];
    const seededSkus = insertedForSkus.map((p) => p.sku);
    jest.clearAllMocks();

    usersMock.findOneBy.mockResolvedValue({ id: 'admin-1' });
    productsMock.find.mockResolvedValue(seededSkus.map((sku) => ({ sku })));

    await service.onApplicationBootstrap();

    expect(usersMock.save).not.toHaveBeenCalled();
    expect(productsMock.insert).not.toHaveBeenCalled();
  });
});
