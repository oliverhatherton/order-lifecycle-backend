import { writeFile } from 'node:fs/promises';

import autocannon from 'autocannon';

/**
 * Load-tests a running instance of this app. Registers a throwaway user, then
 * fires concurrent requests at a handful of representative endpoints —
 * an unauthenticated liveness check, an authenticated read backed by the DB,
 * and a cache-aside read (see CacheService) — reporting req/sec and latency
 * percentiles for each. Run against a locally started app with `pnpm
 * test:load`, or see the `load-test` job in .github/workflows/ci.yml for how
 * CI boots the full stack (Postgres/RabbitMQ/Redis + the app) to run this
 * against on every push.
 *
 * This is deliberately read-only: every target endpoint is idempotent, so the
 * same run can be repeated without needing to reset state between attempts.
 */

const BASE_URL = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3000';
const DURATION_SECONDS = Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 15);
const CONNECTIONS = Number(process.env.LOAD_TEST_CONNECTIONS ?? 20);
const HEALTH_TIMEOUT_MS = 60_000;
// When set, the run's scores are written here as JSON so CI can upload them as
// an artifact (see the `load-test` job in .github/workflows/ci.yml).
const OUTPUT_PATH = process.env.LOAD_TEST_OUTPUT;

interface LoginResponse {
  accessToken: string;
}

/** Polls GET /health until the app answers, or throws after HEALTH_TIMEOUT_MS. */
async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${BASE_URL}/health did not become healthy in time`);
}

/** Registers a throwaway user and returns a bearer token for the run. */
async function registerLoadTestUser(): Promise<string> {
  const email = `load-test-${Date.now()}@example.com`;
  const password = 'LoadTest#2026!';

  const registerResponse = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!registerResponse.ok) {
    throw new Error(
      `Failed to register load-test user: ${registerResponse.status} ${await registerResponse.text()}`,
    );
  }

  const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(
      `Failed to log in load-test user: ${loginResponse.status} ${await loginResponse.text()}`,
    );
  }
  const body = (await loginResponse.json()) as LoginResponse;
  return body.accessToken;
}

function summarize(label: string, result: autocannon.Result): void {
  const { requests, latency, non2xx, errors } = result;
  console.log(`\n${label}`);
  console.log(`  req/sec:  ${requests.average.toFixed(1)}`);
  console.log(
    `  latency:  p50 ${latency.p50}ms  p90 ${latency.p90}ms  p97.5 ${latency.p97_5}ms  p99 ${latency.p99}ms`,
  );
  if (non2xx > 0 || errors > 0) {
    console.log(`  ⚠ non-2xx responses: ${non2xx}, errors: ${errors}`);
  }
}

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
  non2xx: number;
  errors: number;
}

interface RunResult {
  result: autocannon.Result;
  score: EndpointScore;
}

async function run(
  label: string,
  path: string,
  token?: string,
): Promise<RunResult> {
  const result = await autocannon({
    url: `${BASE_URL}${path}`,
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  summarize(label, result);
  const score: EndpointScore = {
    label,
    path,
    requestsPerSec: Number(result.requests.average.toFixed(1)),
    latency: {
      p50: result.latency.p50,
      p90: result.latency.p90,
      p97_5: result.latency.p97_5,
      p99: result.latency.p99,
    },
    non2xx: result.non2xx,
    errors: result.errors,
  };
  return { result, score };
}

/** Writes the run's scores to OUTPUT_PATH as JSON, if one was configured. */
async function writeScores(scores: EndpointScore[]): Promise<void> {
  if (!OUTPUT_PATH) return;
  const report = {
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    config: {
      baseUrl: BASE_URL,
      connections: CONNECTIONS,
      durationSeconds: DURATION_SECONDS,
    },
    endpoints: scores,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote load-test scores to ${OUTPUT_PATH}`);
}

async function main(): Promise<void> {
  console.log(
    `Load-testing ${BASE_URL} (${CONNECTIONS} connections, ${DURATION_SECONDS}s per endpoint)`,
  );
  await waitForHealth();
  const token = await registerLoadTestUser();

  const results = [
    await run('GET /health (unauthenticated baseline)', '/health'),
    await run('GET /products (authenticated, DB-backed)', '/products', token),
    await run('GET /orders (authenticated, cache-aside)', '/orders', token),
  ];

  await writeScores(results.map((r) => r.score));

  const hadFailures = results.some(
    (r) => r.result.non2xx > 0 || r.result.errors > 0,
  );
  if (hadFailures) {
    console.error('\nLoad test saw non-2xx responses or connection errors.');
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error('Load test failed to run:', error);
  process.exitCode = 1;
});
