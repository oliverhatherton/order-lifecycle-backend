import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricEventEntity } from '@/entities/metric-event/MetricEventEntity';
import { MetricsHistoryQueryDTO } from '@/modules/metrics/dto/MetricsHistoryQueryDTO';
import {
  MetricHistoryPointDTO,
  MetricsHistoryResponseDTO,
} from '@/modules/metrics/dto/MetricsHistoryResponseDTO';
import { MetricResolution } from '@/modules/metrics/metrics.constants';

/** Bucket width in seconds for each non-raw resolution. */
const BUCKET_SECONDS: Partial<Record<MetricResolution, number>> = {
  [MetricResolution.ONE_HOUR]: 3600,
  [MetricResolution.SIX_HOURS]: 6 * 3600,
  [MetricResolution.TWELVE_HOURS]: 12 * 3600,
  [MetricResolution.ONE_DAY]: 24 * 3600,
  [MetricResolution.ONE_WEEK]: 7 * 24 * 3600,
  // Fixed 30-day width, not a calendar month.
  [MetricResolution.ONE_MONTH]: 30 * 24 * 3600,
};

/**
 * Sentinel "since the beginning" bound used when the caller omits `from` —
 * deliberately not a rolling lookback window. The intent is "open the page
 * and instantly see the whole time the server has been up," so the default
 * has to reach back to the first ever recorded sample, not just the last N
 * hours/days. Response size is still bounded (see MAX_POINTS below): raw
 * takes the most recent 500 samples, bucketed resolutions cap at 500
 * buckets — so an unbounded start doesn't risk an unbounded response.
 */
const SINCE_THE_BEGINNING = new Date(0);

/** Hard cap on rows/buckets returned, regardless of the requested window. */
const MAX_POINTS = 500;

interface RawRow {
  value: string;
  recordedAt: Date;
}

interface BucketRow {
  bucket_start: Date;
  count: string;
  sum: string;
  avg: string;
  min: string;
  max: string;
}

/**
 * Answers `GET /metrics/history`. Defaults to the whole recorded history (no
 * `from` means "since the server started collecting this metric," not a
 * rolling window) — `raw` returns the most recent samples (capped at
 * MAX_POINTS); every other resolution groups samples into fixed-width
 * buckets in the database (cheaper and smaller than shipping every sample to
 * bucket client-side) and is itself capped at MAX_POINTS buckets, so the
 * response size never depends on how much history has accumulated.
 */
@Injectable()
export class MetricsHistoryService {
  constructor(
    @InjectRepository(MetricEventEntity)
    private readonly repository: Repository<MetricEventEntity>,
  ) {}

  async query(dto: MetricsHistoryQueryDTO): Promise<MetricsHistoryResponseDTO> {
    const resolution = dto.resolution ?? MetricResolution.RAW;
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : SINCE_THE_BEGINNING;

    const points =
      resolution === MetricResolution.RAW
        ? await this.queryRaw(dto.metric, from, to)
        : await this.queryBucketed(dto.metric, from, to, resolution);

    return { metric: dto.metric, resolution, points };
  }

  private async queryRaw(
    metric: string,
    from: Date,
    to: Date,
  ): Promise<MetricHistoryPointDTO[]> {
    const rows: RawRow[] = await this.repository.query(
      `SELECT "value", "recordedAt"
       FROM "metric_events"
       WHERE "metric" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3
       ORDER BY "recordedAt" DESC
       LIMIT ${MAX_POINTS}`,
      [metric, from, to],
    );

    // Chronological order, matching the bucketed path.
    return rows.reverse().map((row) => {
      const value = Number(row.value);
      return {
        bucketStart: row.recordedAt.toISOString(),
        count: 1,
        sum: value,
        avg: value,
        min: value,
        max: value,
      };
    });
  }

  private async queryBucketed(
    metric: string,
    from: Date,
    to: Date,
    resolution: MetricResolution,
  ): Promise<MetricHistoryPointDTO[]> {
    const widthSeconds = BUCKET_SECONDS[resolution]!;

    // Bucket, then take the MOST RECENT MAX_POINTS buckets (inner query,
    // DESC + LIMIT) before re-sorting chronologically for the response.
    // Ordering ASC before LIMIT would keep the *oldest* buckets instead —
    // exactly backwards once `from` can span a long, unbounded history.
    const rows: BucketRow[] = await this.repository.query(
      `SELECT * FROM (
         SELECT
           to_timestamp(floor(extract(epoch from "recordedAt") / $4) * $4) AS bucket_start,
           COUNT(*) AS count,
           SUM("value") AS sum,
           AVG("value") AS avg,
           MIN("value") AS min,
           MAX("value") AS max
         FROM "metric_events"
         WHERE "metric" = $1 AND "recordedAt" >= $2 AND "recordedAt" <= $3
         GROUP BY bucket_start
         ORDER BY bucket_start DESC
         LIMIT ${MAX_POINTS}
       ) recent_buckets
       ORDER BY bucket_start ASC`,
      [metric, from, to, widthSeconds],
    );

    return rows.map((row) => ({
      bucketStart: row.bucket_start.toISOString(),
      count: Number(row.count),
      sum: Number(row.sum),
      avg: Number(row.avg),
      min: Number(row.min),
      max: Number(row.max),
    }));
  }
}
