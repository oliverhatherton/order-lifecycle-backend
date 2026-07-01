import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from '@/app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/health')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns `Healthy` when the HTTP server is up. Liveness only — it does ' +
      'not check Postgres/RabbitMQ/Redis connectivity.',
  })
  @ApiOkResponse({
    description: 'Service is up',
    schema: { type: 'string', example: 'Healthy' },
  })
  health(): string {
    return this.appService.health();
  }
}
