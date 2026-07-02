import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ProductEntity } from '@/entities/product/ProductEntity';

/** A line item's product + quantity, the shape reservation/restore work on. */
export interface StockLine {
  productId: string;
  quantity: number;
}

/** Thrown by reserveStock when a product doesn't have enough stock left. */
export class InsufficientStockError extends Error {
  constructor(public readonly productId: string) {
    super(`Insufficient stock for product ${productId}`);
  }
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  /** The catalog, alphabetical — what the UI's "add to cart" screen lists. */
  list(): Promise<ProductEntity[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  findByIds(ids: string[]): Promise<ProductEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('product')
      .where('product.id IN (:...ids)', { ids })
      .getMany();
  }

  /**
   * Atomically decrements stock for every line, one conditional `UPDATE ...
   * WHERE stock >= quantity` per product (the same atomic-claim pattern as
   * OrdersService.initiatePayment's payment claim). Runs inside `manager` —
   * the caller's existing transaction (the inbox transaction, for
   * InventoryConsumer) — but deliberately does NOT rely on that transaction
   * rolling back on failure: the caller still needs to commit a FAILED
   * transition (+ the inbox record) in the *same* transaction when a product
   * comes up short, so the transaction as a whole must succeed either way.
   * Instead, on a short product this compensates for itself — restoring
   * every line already decremented for this call — before throwing
   * InsufficientStockError, so nothing leaks regardless of what the caller
   * does with the transaction afterwards.
   */
  async reserveStock(
    lines: StockLine[],
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(ProductEntity);
    const applied: StockLine[] = [];
    try {
      for (const line of lines) {
        const result = await repository
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ stock: () => 'stock - :qty' })
          .where('id = :id', { id: line.productId })
          .andWhere('stock >= :qty', { qty: line.quantity })
          .execute();
        if (result.affected === 0) {
          throw new InsufficientStockError(line.productId);
        }
        applied.push(line);
      }
    } catch (error) {
      if (applied.length > 0) {
        await this.restoreStock(applied, manager);
      }
      throw error;
    }
  }

  /**
   * Increments stock back for every line — used when cancelling a RESERVED
   * order. Takes an optional `manager` to participate in a caller's
   * transaction (not required to be atomic-with-anything else the way
   * reserveStock is, since there's no "insufficient" case to roll back on).
   */
  async restoreStock(
    lines: StockLine[],
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(ProductEntity)
      : this.repository;
    for (const line of lines) {
      await repository
        .createQueryBuilder()
        .update(ProductEntity)
        .set({ stock: () => 'stock + :qty' })
        .where('id = :id', { id: line.productId })
        .setParameter('qty', line.quantity)
        .execute();
    }
  }
}
