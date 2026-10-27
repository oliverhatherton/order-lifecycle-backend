import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserEntity } from '@/entities/user/UserEntity';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { seedAdmin } from '@/database/seeds/create-admin';

/** Same fallback the docs (`.env.example`) already promise for local/demo use. */
const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
const DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!';

/**
 * The shop's catalog: a motorsport store — driver kit, car parts and
 * track-day gear. Generic product names (no real brands), stock levels that
 * fit the item (a dozen helmets, a hundred caps). Insert-if-missing by `sku`,
 * see seedProducts.
 */
const CATALOG: ReadonlyArray<{
  sku: string;
  name: string;
  stock: number;
}> = [
  // Driver kit
  { sku: 'HEL-CF8859', name: 'Carbon Race Helmet, FIA 8859', stock: 12 },
  { sku: 'SUIT-3L8856', name: 'Three-Layer Race Suit, FIA 8856', stock: 15 },
  { sku: 'GLV-NMX', name: 'Nomex Race Gloves', stock: 40 },
  { sku: 'BOOT-SDE', name: 'Suede Race Boots', stock: 22 },
  { sku: 'HNR-M', name: 'Head and Neck Restraint, Medium', stock: 10 },
  { sku: 'BAL-NMX', name: 'Nomex Balaclava', stock: 60 },
  // Car parts
  { sku: 'BRK-END-F', name: 'Endurance Brake Pads, Front Axle', stock: 30 },
  { sku: 'FLD-DOT5', name: 'Racing Brake Fluid, 500 ml', stock: 80 },
  { sku: 'WHL-350S', name: '350 mm Suede Steering Wheel', stock: 18 },
  { sku: 'HUB-QR', name: 'Quick-Release Steering Hub', stock: 25 },
  { sku: 'HRN-6PT', name: '6-Point Racing Harness', stock: 20 },
  { sku: 'TYR-18M', name: 'Slick Tyre, 18 in, Medium Compound', stock: 48 },
  { sku: 'EXT-1KG', name: 'Handheld Fire Extinguisher, 1 kg', stock: 35 },
  // Track day
  { sku: 'LAP-GPS', name: 'GPS Lap Timer', stock: 16 },
  { sku: 'FLG-CHQ', name: 'Chequered Flag', stock: 70 },
  { sku: 'MDL-LMP18', name: '1:18 Le Mans Prototype Model', stock: 24 },
  { sku: 'CAP-PIT', name: 'Pit Crew Cap', stock: 90 },
  { sku: 'TPG-DIG', name: 'Digital Tyre Pressure Gauge', stock: 45 },
];

/**
 * The original placeholder catalog. Retired rather than deleted (past order
 * items still reference them): hidden from the shop and removed from any
 * open cart on boot.
 */
const RETIRED_SKUS: readonly string[] = [
  'WIDGET-001',
  'WIDGET-002',
  'GADGET-001',
  'GADGET-002',
  'GIZMO-001',
  'GIZMO-002',
  'DOOHICKEY-001',
  'THINGAMAJIG-001',
  'CONTRAPTION-001',
  'WHATSIT-001',
  'DOODAD-001',
  'GEEGAW-001',
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
 * - Retired SKUs are switched off and dropped from open carts; orders that
 *   already contain them are left exactly as they were.
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
    await this.retireOldProducts();
  }

  private async seedProducts(): Promise<void> {
    const existing = await this.products.find({ select: { sku: true } });
    const existingSkus = new Set(existing.map((product) => product.sku));

    const missing = CATALOG.filter((product) => !existingSkus.has(product.sku));
    if (missing.length === 0) return;

    await this.products.insert(missing);
    this.logger.log(`Seeded ${missing.length} new product(s).`);
  }

  private async retireOldProducts(): Promise<void> {
    const retired = await this.products.update(
      { sku: In([...RETIRED_SKUS]), active: true },
      { active: false },
    );
    if (!retired.affected) return;

    // Lines for retired products can't be checked out any more; take them
    // out of carts that are still open. Checked-out carts are history.
    await this.products.manager.query(
      `DELETE FROM "cart_items" ci
       USING "carts" c, "products" p
       WHERE ci."cartId" = c."id" AND ci."productId" = p."id"
         AND c."checkedOutAt" IS NULL AND p."active" = false`,
    );
    this.logger.log(`Retired ${retired.affected} old product(s).`);
  }
}
