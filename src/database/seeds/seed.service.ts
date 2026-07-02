import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { seedAdmin } from '@/database/seeds/create-admin';

/** Same fallback the docs (`.env.example`) already promise for local/demo use. */
const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
const DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!';

/** Starting demo catalog — insert-if-missing by `sku`, see seedProducts. */
const DEMO_PRODUCTS: ReadonlyArray<{
  sku: string;
  name: string;
  stock: number;
}> = [
  { sku: 'WIDGET-001', name: 'Standard Widget', stock: 75 },
  { sku: 'WIDGET-002', name: 'Deluxe Widget', stock: 60 },
  { sku: 'GADGET-001', name: 'Pocket Gadget', stock: 90 },
  { sku: 'GADGET-002', name: 'Pro Gadget', stock: 45 },
  { sku: 'GIZMO-001', name: 'Mini Gizmo', stock: 100 },
  { sku: 'GIZMO-002', name: 'Mega Gizmo', stock: 30 },
  { sku: 'DOOHICKEY-001', name: 'Classic Doohickey', stock: 80 },
  { sku: 'THINGAMAJIG-001', name: 'Adjustable Thingamajig', stock: 55 },
  { sku: 'CONTRAPTION-001', name: 'Rube Goldberg Contraption', stock: 20 },
  { sku: 'WHATSIT-001', name: 'Assorted Whatsit', stock: 65 },
  { sku: 'DOODAD-001', name: 'Sparkly Doodad', stock: 40 },
  { sku: 'GEEGAW-001', name: 'Vintage Geegaw', stock: 25 },
];

/**
 * Boot-time demo data — runs after every module has initialized, in every
 * environment (this is a demo/portfolio backend; the deployed instance needs
 * the same data as local dev). Both steps are idempotent:
 * - The admin user reuses `seedAdmin` (also usable stand-alone via
 *   `pnpm admin:create`), keyed on email.
 * - Products insert-if-missing by `sku` — an existing product's `stock` is
 *   never touched, so a redeploy doesn't undo whatever a running instance's
 *   users have already depleted (which would defeat the point of demoing
 *   auto-replenishment).
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await seedAdmin(
      this.users,
      {
        email: process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
      },
      this.logger,
    );
    await this.seedProducts();
  }

  private async seedProducts(): Promise<void> {
    const existing = await this.products.find({ select: { sku: true } });
    const existingSkus = new Set(existing.map((product) => product.sku));

    const missing = DEMO_PRODUCTS.filter(
      (product) => !existingSkus.has(product.sku),
    );
    if (missing.length === 0) return;

    await this.products.insert(missing);
    this.logger.log(`Seeded ${missing.length} new product(s).`);
  }
}
