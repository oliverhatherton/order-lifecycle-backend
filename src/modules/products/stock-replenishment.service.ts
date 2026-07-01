import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from '@/entities/product/ProductEntity';
import { recordMetricSample } from '@/modules/metrics/metrics.collectors';

/** Stock at or below this is a replenishment candidate every tick. */
const LOW_STOCK_THRESHOLD = 10;
/** Stock at or below this always restocks (probability 1). */
const GUARANTEED_RESTOCK_AT = 5;
const RESTOCK_MIN = 50;
const RESTOCK_MAX = 100;

/**
 * Self-heals low stock so a demo never needs a manual restock. Every minute,
 * every product at or below LOW_STOCK_THRESHOLD is a candidate: at
 * GUARANTEED_RESTOCK_AT or below it always tops up; between that and the
 * threshold the odds ramp up linearly the lower stock gets (so a product
 * doesn't usually sit right at the edge for many ticks in a row, but also
 * doesn't restock the instant it dips under 10). The top-up amount is random
 * within [RESTOCK_MIN, RESTOCK_MAX] so replenishment looks organic rather
 * than snapping to a fixed number.
 */
@Injectable()
export class StockReplenishmentService {
  private readonly logger = new Logger(StockReplenishmentService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async replenishLowStock(): Promise<void> {
    const lowStock = await this.repository
      .createQueryBuilder('product')
      .where('product.stock <= :threshold', { threshold: LOW_STOCK_THRESHOLD })
      .getMany();

    for (const product of lowStock) {
      if (!this.shouldRestock(product.stock)) continue;

      const amount = this.randomRestockAmount();
      await this.repository
        .createQueryBuilder()
        .update(ProductEntity)
        .set({ stock: () => 'stock + :amount' })
        .where('id = :id', { id: product.id })
        .setParameter('amount', amount)
        .execute();

      this.logger.log(
        `Replenished ${product.name} (${product.id}): ${product.stock} -> +${amount}`,
      );
      recordMetricSample('stock_replenished', amount, {
        productId: product.id,
      });
    }
  }

  /**
   * True at GUARANTEED_RESTOCK_AT or below (always). Between that and
   * LOW_STOCK_THRESHOLD, probability ramps linearly from low (near the
   * threshold) to high (near the guaranteed floor) — `(11 - stock) / 6` for
   * stock in [6,10] gives ~17% at 10 up to ~83% at 6.
   */
  private shouldRestock(stock: number): boolean {
    if (stock <= GUARANTEED_RESTOCK_AT) return true;
    const probability = (11 - stock) / 6;
    return Math.random() < probability;
  }

  private randomRestockAmount(): number {
    return (
      Math.floor(Math.random() * (RESTOCK_MAX - RESTOCK_MIN + 1)) + RESTOCK_MIN
    );
  }
}
