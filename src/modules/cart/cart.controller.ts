import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '@/modules/auth/decorators/CurrentUser';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import type { JwtPayload } from '@/modules/auth/types/JwtPayload';
import { CartService } from '@/modules/cart/cart.service';
import {
  CartResponseDTO,
  toCartResponseDTO,
} from '@/modules/cart/dto/CartResponseDTO';
import { SetCartItemDTO } from '@/modules/cart/dto/SetCartItemDTO';
import {
  OrderResponseDTO,
  toOrderResponseDTO,
} from '@/modules/orders/dto/OrderResponseDTO';

// Every route requires authentication; a cart is always the caller's own —
// there's no way to address another user's cart, so no ownership param.
@ApiTags('cart')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's open cart",
    description: "Created lazily if the caller doesn't have one yet.",
  })
  @ApiOkResponse({ type: CartResponseDTO })
  async get(@CurrentUser() user: JwtPayload): Promise<CartResponseDTO> {
    return toCartResponseDTO(await this.cart.getOpenCart(user.sub));
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set a line item's quantity in the cart (upsert)",
    description:
      'Sets the quantity, rather than adding to it — send the desired total.',
  })
  @ApiOkResponse({ type: CartResponseDTO })
  @ApiNotFoundResponse({ description: 'No such product' })
  async setItem(
    @CurrentUser() user: JwtPayload,
    @Body() body: SetCartItemDTO,
  ): Promise<CartResponseDTO> {
    const cart = await this.cart.setItem(
      user.sub,
      body.productId,
      body.quantity,
    );
    return toCartResponseDTO(cart);
  }

  @Delete('items/:productId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line item from the cart' })
  @ApiOkResponse({ type: CartResponseDTO })
  async removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartResponseDTO> {
    const cart = await this.cart.removeItem(user.sub, productId);
    return toCartResponseDTO(cart);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Check out the cart — creates the order (once only)',
    description:
      'Atomically claims the cart so it can only ever be checked out once, ' +
      'even under a double-click, then creates a PENDING order from its line ' +
      'items exactly like the old POST /orders did. Poll GET /orders/{id} for ' +
      'the async fulfilment as before.',
  })
  @ApiCreatedResponse({ type: OrderResponseDTO })
  @ApiConflictResponse({
    description: 'Cart is empty, or has already been checked out.',
  })
  async checkout(@CurrentUser() user: JwtPayload): Promise<OrderResponseDTO> {
    const order = await this.cart.checkout(user.sub);
    return toOrderResponseDTO(order);
  }
}
