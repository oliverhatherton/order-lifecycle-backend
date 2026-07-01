import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CartEntity } from '@/entities/cart/CartEntity';
import { CartItemEntity } from '@/entities/cart/CartItemEntity';
import { OrderEntity } from '@/entities/order/OrderEntity';
import { ProductsService } from '@/modules/products/products.service';
import { OrdersService } from '@/modules/orders/services/orders.service';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartEntity)
    private readonly cartRepository: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemRepository: Repository<CartItemEntity>,
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * The caller's open (not yet checked-out) cart, created lazily on first
   * use. A user has at most one at a time — see CartEntity's doc for why
   * that's enough to make "checked out once" hold without extra state.
   */
  async getOpenCart(userId: string): Promise<CartEntity> {
    const existing = await this.cartRepository.findOne({
      where: { userId, checkedOutAt: IsNull() },
      relations: { items: { product: true } },
    });
    if (existing) return existing;

    const created = await this.cartRepository.save(
      this.cartRepository.create({ userId }),
    );
    created.items = [];
    return created;
  }

  /** Upserts a line item's quantity (sets it, doesn't add to it). */
  async setItem(
    userId: string,
    productId: string,
    quantity: number,
  ): Promise<CartEntity> {
    const [cart, [product]] = await Promise.all([
      this.getOpenCart(userId),
      this.products.findByIds([productId]),
    ]);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.cartItemRepository.upsert(
      { cartId: cart.id, productId, quantity },
      ['cartId', 'productId'],
    );
    return this.getOpenCart(userId);
  }

  async removeItem(userId: string, productId: string): Promise<CartEntity> {
    const cart = await this.getOpenCart(userId);
    await this.cartItemRepository.delete({ cartId: cart.id, productId });
    return this.getOpenCart(userId);
  }

  /**
   * The one-shot checkout: atomically claims the cart (only one caller can
   * ever win, even under a double-click), then creates the real order from
   * its line items. Once claimed, this cart is permanently checked out —
   * getOpenCart will lazily start a fresh one for the user's next action.
   */
  async checkout(userId: string): Promise<OrderEntity> {
    const cart = await this.getOpenCart(userId);
    const items = cart.items ?? [];
    if (items.length === 0) {
      throw new ConflictException('Cart is empty');
    }

    const claim = await this.cartRepository
      .createQueryBuilder()
      .update(CartEntity)
      .set({ checkedOutAt: () => 'now()' })
      .where('id = :id', { id: cart.id })
      .andWhere('"checkedOutAt" IS NULL')
      .execute();
    if (claim.affected === 0) {
      throw new ConflictException('Cart has already been checked out');
    }

    const lines = items.map((item) => ({
      productId: item.productId,
      // product is always loaded (see getOpenCart's relations) for an item
      // that made it through setItem's existence check.
      productName: item.product!.name,
      quantity: item.quantity,
    }));
    return this.orders.createOrder(userId, lines);
  }
}
