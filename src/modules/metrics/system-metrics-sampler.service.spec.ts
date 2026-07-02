import { setMetricsSink } from '@/modules/metrics/metrics.collectors';
import { SystemMetricsSamplerService } from '@/modules/metrics/system-metrics-sampler.service';

describe('SystemMetricsSamplerService', () => {
  let service: SystemMetricsSamplerService;
  let record: jest.Mock;

  beforeEach(() => {
    service = new SystemMetricsSamplerService();
    record = jest.fn();
    setMetricsSink({ record });
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    setMetricsSink(undefined);
  });

  /** The value the sink received for the given metric name. */
  function recordedValue(metric: string): number {
    const calls = record.mock.calls as [string, number][];
    return calls.find(([name]) => name === metric)![1];
  }

  it('records memory and CPU gauges on every tick', () => {
    service.sample();

    expect(record).toHaveBeenCalledWith(
      'memory_heap_used_bytes',
      expect.any(Number),
      undefined,
    );
    expect(record).toHaveBeenCalledWith(
      'memory_rss_bytes',
      expect.any(Number),
      undefined,
    );
    expect(record).toHaveBeenCalledWith(
      'cpu_percent',
      expect.any(Number),
      undefined,
    );

    expect(recordedValue('cpu_percent')).toBeGreaterThanOrEqual(0);
  });

  it('records event loop lag once the monitor has observed a turn', async () => {
    // Give the delay monitor (10ms resolution) time to collect samples.
    await new Promise((resolve) => setTimeout(resolve, 50));

    service.sample();

    expect(record).toHaveBeenCalledWith(
      'event_loop_lag_ms',
      expect.any(Number),
      undefined,
    );
    expect(record).toHaveBeenCalledWith(
      'event_loop_lag_max_ms',
      expect.any(Number),
      undefined,
    );

    const lagMs = recordedValue('event_loop_lag_ms');
    const maxMs = recordedValue('event_loop_lag_max_ms');
    expect(Number.isFinite(lagMs)).toBe(true);
    expect(maxMs).toBeGreaterThanOrEqual(lagMs);
  });

  it('skips the lag sample (but not memory/CPU) when the monitor is empty', () => {
    // No awaited turn since enable(): the perf_hooks histogram has no
    // samples yet and its mean is NaN — nothing useful to persist.
    service.sample();

    const lagCalls = record.mock.calls.filter(([metric]) =>
      String(metric).startsWith('event_loop_lag'),
    );
    for (const [, value] of lagCalls) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(record).toHaveBeenCalledWith(
      'memory_heap_used_bytes',
      expect.any(Number),
      undefined,
    );
  });

  it('never throws when no sink is set', () => {
    setMetricsSink(undefined);
    expect(() => service.sample()).not.toThrow();
  });
});
