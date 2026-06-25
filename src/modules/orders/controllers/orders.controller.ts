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
  ApiBearerAuth,
  ApiNotFoundResponse,
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
  @ApiOperation({ summary: 'Create a new PENDING order for the caller' })
  async create(@CurrentUser() user: JwtPayload): Promise<OrderResponseDTO> {
    const order = await this.ordersService.createOrder(user.sub);
    return toOrderResponseDTO(order);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's own orders (newest first)" })
  async list(@CurrentUser() user: JwtPayload): Promise<OrderResponseDTO[]> {
    const orders = await this.ordersService.listOrdersForUser(user.sub);
    return orders.map(toOrderResponseDTO);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one of the caller’s orders by id' })
  @ApiNotFoundResponse({ description: 'No such order owned by the caller' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrderResponseDTO> {
    const order = await this.ordersService.getOrderForUser(id, user.sub);
    return toOrderResponseDTO(order);
  }
}
