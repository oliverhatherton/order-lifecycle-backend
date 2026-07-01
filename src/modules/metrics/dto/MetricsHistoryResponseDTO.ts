import { ApiProperty } from '@nestjs/swagger';
import { MetricResolution } from '@/modules/metrics/metrics.constants';

/** One bucket (or, at `raw` resolution, one sample) in a history response. */
export class MetricHistoryPointDTO {
  @ApiProperty({
    format: 'date-time',
    description:
      'Start of the bucket (or the sample timestamp itself at raw resolution).',
  })
  bucketStart: string;

  @ApiProperty({ description: 'Number of samples in this bucket.' })
  count: number;

  @ApiProperty({
    description:
      'Sum of sample values — the meaningful figure for counter metrics ' +
      '(e.g. orders_terminal), since each sample is 1.',
  })
  sum: number;

  @ApiProperty({
    description:
      'Average sample value — the meaningful figure for duration metrics ' +
      '(e.g. db_query_duration_ms).',
  })
  avg: number;

  @ApiProperty()
  min: number;

  @ApiProperty()
  max: number;
}

export class MetricsHistoryResponseDTO {
  @ApiProperty()
  metric: string;

  @ApiProperty({ enum: MetricResolution })
  resolution: MetricResolution;

  @ApiProperty({ type: [MetricHistoryPointDTO] })
  points: MetricHistoryPointDTO[];
}
