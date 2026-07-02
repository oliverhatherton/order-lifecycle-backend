import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { monitorEventLoopDelay } from 'perf_hooks';
import type { IntervalHistogram } from 'perf_hooks';
import { recordMetricSample } from '@/modules/metrics/metrics.collectors';
import { SYSTEM_SAMPLE_INTERVAL_MS } from '@/modules/metrics/metrics.constants';

/**
 * Snapshots process-level gauges into `metric_events` on a fixed interval, so
 * `GET /metrics/history` has a continuous series for the whole uptime — not
 * just rows while traffic happens. This is what lets a dashboard overlay a
 * traffic spike (`http_request_duration_ms` count/avg) against what it did to
 * event loop lag, memory and CPU at the same timestamps.
 *
 * Every tick records:
 *  - `event_loop_lag_ms` / `event_loop_lag_max_ms` — mean and worst-case
 *    event loop delay since the previous tick (perf_hooks monitor, reset
 *    after each sample so ticks don't smear into each other)
 *  - `memory_heap_used_bytes`, `memory_rss_bytes`
 *  - `cpu_percent` — process CPU (user+system) over the wall-clock interval
 *
 * Goes through `recordMetricSample`, i.e. the durable sink only: Prometheus
 * already exposes live equivalents via its default metrics, and the sink is
 * fire-and-forget, so a tick can never block or fail on a slow database.
 */
@Injectable()
export class SystemMetricsSamplerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly loopDelay: IntervalHistogram = monitorEventLoopDelay();
  private lastCpu = process.cpuUsage();
  private lastCpuAt = process.hrtime.bigint();

  onModuleInit(): void {
    this.loopDelay.enable();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = process.hrtime.bigint();
  }

  onModuleDestroy(): void {
    this.loopDelay.disable();
  }

  @Interval(SYSTEM_SAMPLE_INTERVAL_MS)
  sample(): void {
    this.sampleEventLoopLag();
    this.sampleMemory();
    this.sampleCpu();
  }

  private sampleEventLoopLag(): void {
    // perf_hooks reports nanoseconds; NaN/0 before the first event loop turn.
    const meanMs = this.loopDelay.mean / 1e6;
    const maxMs = this.loopDelay.max / 1e6;
    this.loopDelay.reset();
    if (!Number.isFinite(meanMs)) return;

    recordMetricSample('event_loop_lag_ms', meanMs);
    recordMetricSample('event_loop_lag_max_ms', maxMs);
  }

  private sampleMemory(): void {
    const usage = process.memoryUsage();
    recordMetricSample('memory_heap_used_bytes', usage.heapUsed);
    recordMetricSample('memory_rss_bytes', usage.rss);
  }

  private sampleCpu(): void {
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - this.lastCpuAt) / 1e3;
    const cpu = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    if (elapsedMicros <= 0) return;

    const percent = ((cpu.user + cpu.system) / elapsedMicros) * 100;
    recordMetricSample('cpu_percent', percent);
  }
}
