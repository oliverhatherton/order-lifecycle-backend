import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsISO8601, IsOptional } from 'class-validator';
import {
  MetricResolution,
  PERSISTED_METRICS,
} from '@/modules/metrics/metrics.constants';
import type { PersistedMetricName } from '@/modules/metrics/metrics.constants';

/** Query params for `GET /metrics/history`. */
export class MetricsHistoryQueryDTO {
  @ApiProperty({
    enum: PERSISTED_METRICS,
    description: 'Which persisted metric to fetch history for.',
  })
  @IsIn(PERSISTED_METRICS)
  metric: PersistedMetricName;

  @ApiProperty({
    enum: MetricResolution,
    required: false,
    default: MetricResolution.RAW,
    description:
      '`raw` returns individual samples (capped at the 500 most recent). Any ' +
      'other value groups samples into fixed-width buckets of that size.',
  })
  @IsOptional()
  @IsEnum(MetricResolution)
  resolution?: MetricResolution;

  @ApiProperty({
    required: false,
    description:
      'ISO-8601 start of the window (inclusive). Omit to get the whole ' +
      'recorded history (since the server started collecting this metric) — ' +
      'not a rolling lookback window. The response still stays small: `raw` ' +
      'returns at most the 500 most recent samples, and every bucketed ' +
      'resolution caps at 500 buckets regardless of how far back this goes.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({
    required: false,
    description: 'ISO-8601 end of the window (inclusive). Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
