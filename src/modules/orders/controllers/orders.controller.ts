import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  OrderResponseDTO,
  toOrderResponseDTO,
} from '@/modules/orders/dto/OrderResponseDTO';
import { OrdersService } from '@/modules/orders/services/orders.service';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { CurrentUser } from '@/modules/auth/decorators/CurrentUser';
import type { JwtPayload } from '@/modules/auth/types/JwtPayload';

// Every route requires authentication; orders are always scoped to the caller.
@ApiTags('orders')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's own orders (newest first)" })
  @ApiOkResponse({
    type: [OrderResponseDTO],
    description: "The caller's orders, most recent first.",
  })
  async list(@CurrentUser() user: JwtPayload): Promise<OrderResponseDTO[]> {
    const orders = await this.ordersService.listOrdersForUser(user.sub);
    return orders.map(toOrderResponseDTO);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one of the caller’s orders by id' })
  @ApiOkResponse({
    type: OrderResponseDTO,
    description: 'The requested order.',
  })
  @ApiBadRequestResponse({ description: 'Malformed order id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'No such order owned by the caller' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDTO> {
    const order = await this.ordersService.getOrderForUser(id, user.sub);
    return toOrderResponseDTO(order);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm (simulated) payment on a RESERVED order',
    description:
      'Inventory reservation no longer auto-advances the order to payment — ' +
      'it pauses in RESERVED until the caller confirms here. Returns ' +
      'immediately with the order still RESERVED; payment authorization runs ' +
      'asynchronously, so poll GET /orders/{id} to see it advance to PAID ' +
      'then COMPLETED (or FAILED on decline).',
  })
  @ApiOkResponse({
    type: OrderResponseDTO,
    description: 'The order, still RESERVED — poll for the async outcome.',
  })
  @ApiBadRequestResponse({ description: 'Malformed order id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'No such order owned by the caller' })
  @ApiConflictResponse({
    description:
      'Order is not RESERVED, or payment was already initiated for it.',
  })
  async pay(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDTO> {
    const order = await this.ordersService.initiatePayment(id, user.sub);
    return toOrderResponseDTO(order);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a PENDING or (pre-payment) RESERVED order',
    description:
      'Allowed while PENDING, or RESERVED as long as payment has not been ' +
      'confirmed yet (POST /orders/{id}/pay hasn’t been called). Restores ' +
      'any reserved stock. Once payment is confirmed, or the order has ' +
      'reached PAID/COMPLETED/FAILED, cancellation is no longer possible.',
  })
  @ApiOkResponse({
    type: OrderResponseDTO,
    description: 'The now-CANCELLED order.',
  })
  @ApiBadRequestResponse({ description: 'Malformed order id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'No such order owned by the caller' })
  @ApiConflictResponse({
    description: 'Order is not cancellable in its current state.',
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDTO> {
    const order = await this.ordersService.cancelOrder(id, user.sub);
    return toOrderResponseDTO(order);
  }
}
