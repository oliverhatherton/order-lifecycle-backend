import { readFile, writeFile } from 'node:fs/promises';

/**
 * Converts the JSON report written by ops/load-test.ts (LOAD_TEST_OUTPUT)
 * into the two flavours of the "customSmallerIsBetter" / "customBiggerIsBetter"
 * benchmark format that benchmark-action/github-action-benchmark expects
 * (https://github.com/benchmark-action/github-action-benchmark#examples) —
 * throughput and latency use opposite "better" directions, so the action
 * needs them as separate files/tool invocations. See the `load-test` job in
 * .github/workflows/ci.yml for how these feed the trend chart on gh-pages.
 */

interface EndpointScore {
  label: string;
  path: string;
  requestsPerSec: number;
  latency: {
    p50: number;
    p90: number;
    p97_5: number;
    p99: number;
  };
}

interface LoadTestReport {
  endpoints: EndpointScore[];
}

interface BenchmarkEntry {
  name: string;
  unit: string;
  value: number;
}

const [reportPath, throughputOutPath, latencyOutPath] = process.argv.slice(2);
if (!reportPath || !throughputOutPath || !latencyOutPath) {
  throw new Error(
    'Usage: format-benchmark.ts <report.json> <throughput-out.json> <latency-out.json>',
  );
}

async function main(): Promise<void> {
  const report = JSON.parse(
    await readFile(reportPath, 'utf8'),
  ) as LoadTestReport;

  const throughput: BenchmarkEntry[] = report.endpoints.map((endpoint) => ({
    name: `${endpoint.label} req/sec`,
    unit: 'req/sec',
    value: endpoint.requestsPerSec,
  }));

  const latency: BenchmarkEntry[] = report.endpoints.flatMap((endpoint) => [
    { name: `${endpoint.label} p50`, unit: 'ms', value: endpoint.latency.p50 },
    { name: `${endpoint.label} p90`, unit: 'ms', value: endpoint.latency.p90 },
    {
      name: `${endpoint.label} p99`,
      unit: 'ms',
      value: endpoint.latency.p99,
    },
  ]);

  await writeFile(
    throughputOutPath,
    `${JSON.stringify(throughput, null, 2)}\n`,
  );
  await writeFile(latencyOutPath, `${JSON.stringify(latency, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error('Failed to format benchmark data:', error);
  process.exitCode = 1;
});
