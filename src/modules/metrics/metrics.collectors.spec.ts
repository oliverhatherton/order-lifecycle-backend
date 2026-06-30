import type { Counter, Histogram } from 'prom-client';
import {
  consumerMessagesTotal,
  dbQueryDuration,
  ordersTerminalTotal,
  recordConsumerOutcome,
  recordTerminalState,
  timeDb,
} from '@/modules/metrics/metrics.collectors';

/** Reads the current value of a counter sample matching the given labels. */
async function counterValue(
  counter: Counter<string>,
  labels: Record<string, string>,
): Promise<number> {
  const metric = await counter.get();
  const sample = metric.values.find((value) =>
    Object.entries(labels).every(([key, val]) => value.labels[key] === val),
  );
  return sample?.value ?? 0;
}

/** Reads a histogram's `_count` for the given labels. */
async function histogramCount(
  histogram: Histogram<string>,
  labels: Record<string, string>,
): Promise<number> {
  const metric = await histogram.get();
  const sample = metric.values.find(
    (value) =>
      value.metricName === `${metric.name}_count` &&
      Object.entries(labels).every(([key, val]) => value.labels[key] === val),
  );
  return sample?.value ?? 0;
}

describe('metrics.collectors', () => {
  it('recordConsumerOutcome increments consumer_messages_total by outcome', async () => {
    const before = await counterValue(consumerMessagesTotal, {
      consumer: 'unit',
      outcome: 'processed',
    });

    recordConsumerOutcome('unit', 'processed');

    const after = await counterValue(consumerMessagesTotal, {
      consumer: 'unit',
      outcome: 'processed',
    });
    expect(after - before).toBe(1);
  });

  it('recordTerminalState increments orders_terminal_total by state', async () => {
    const before = await counterValue(ordersTerminalTotal, {
      state: 'completed',
    });

    recordTerminalState('completed');

    const after = await counterValue(ordersTerminalTotal, {
      state: 'completed',
    });
    expect(after - before).toBe(1);
  });

  it('timeDb returns the work result and records a duration sample', async () => {
    const before = await histogramCount(dbQueryDuration, {
      operation: 'unit.op',
    });

    const result = await timeDb('unit.op', () => Promise.resolve(42));

    expect(result).toBe(42);
    const after = await histogramCount(dbQueryDuration, {
      operation: 'unit.op',
    });
    expect(after - before).toBe(1);
  });
});
