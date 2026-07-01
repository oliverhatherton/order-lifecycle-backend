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
      '`raw` returns individual samples (capped, most recent window). Any ' +
      'other value groups samples into fixed-width buckets of that size.',
  })
  @IsOptional()
  @IsEnum(MetricResolution)
  resolution?: MetricResolution;

  @ApiProperty({
    required: false,
    description:
      'ISO-8601 start of the window (inclusive). Defaults per resolution.',
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
