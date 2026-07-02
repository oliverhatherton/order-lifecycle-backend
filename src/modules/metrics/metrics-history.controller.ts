import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/JwtAuthGuard';
import { MetricsHistoryQueryDTO } from '@/modules/metrics/dto/MetricsHistoryQueryDTO';
import { MetricsHistoryResponseDTO } from '@/modules/metrics/dto/MetricsHistoryResponseDTO';
import { MetricsHistoryService } from '@/modules/metrics/metrics-history.service';

/**
 * JSON metric history for a UI dashboard, distinct from `/metrics`
 * (Prometheus exposition, unauthenticated, in-memory-only, scrape-shaped).
 * This is authenticated, durable (backed by `metric_events`, survives a
 * restart) and pre-aggregated server-side so the response stays small
 * regardless of how much history has accumulated — see MetricsHistoryService.
 */
@ApiTags('metrics')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('metrics/history')
@UseGuards(JwtAuthGuard)
export class MetricsHistoryController {
  constructor(private readonly history: MetricsHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Durable, resolution-bucketed metric history',
    description:
      'Backed by a Postgres table (`metric_events`), not the in-memory ' +
      'Prometheus registry — history survives a restart. Omitting `from` ' +
      'returns the whole recorded history (since the server started ' +
      'collecting this metric), not a rolling window — open the page and ' +
      'get everything since boot in one call. `resolution=raw` returns ' +
      'individual samples (capped at the 500 most recent); ' +
      '1m/5m/15m/1h/6h/12h/1d/1w/1mo group samples into buckets of that ' +
      'width so the response size never depends on how much history has ' +
      'accumulated. Use a fine resolution (1m/5m) to chart traffic spikes ' +
      'against the interval-sampled system gauges (event_loop_lag_ms, ' +
      'memory_*, cpu_percent), which are recorded every 15s for the whole ' +
      'uptime.',
  })
  @ApiOkResponse({ type: MetricsHistoryResponseDTO })
  async get(
    @Query() query: MetricsHistoryQueryDTO,
  ): Promise<MetricsHistoryResponseDTO> {
    return this.history.query(query);
  }
}
