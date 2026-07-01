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
  ApiCreatedResponse,
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new PENDING order for the caller',
    description:
      'Takes no body. Returns immediately with status PENDING; fulfilment ' +
      '(reserve → pay → complete) then runs asynchronously, so poll GET ' +
      '/orders/{id} to observe the status advance.',
  })
  @ApiCreatedResponse({
    type: OrderResponseDTO,
    description: 'The created order, in PENDING state.',
  })
  async create(@CurrentUser() user: JwtPayload): Promise<OrderResponseDTO> {
    const order = await this.ordersService.createOrder(user.sub);
    return toOrderResponseDTO(order);
  }

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
}
