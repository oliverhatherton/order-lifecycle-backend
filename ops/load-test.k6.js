/* global __ENV */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

/**
 * k6 load test against a running instance of this app. `setup()` registers a
 * throwaway user and drives a handful of real orders through the whole async
 * pipeline (cart → checkout → RESERVED → pay → COMPLETED), so the cache-aside
 * endpoints have genuine terminal orders to serve. Then one scenario per
 * endpoint runs back to back at a constant number of VUs:
 *
 *   - GET /health        unauthenticated baseline (no DB, no cache)
 *   - GET /products      authenticated, DB-backed, never cached
 *   - GET /orders        cache-aside list (orders:user:{id})
 *   - GET /orders/:id    cache-aside by id (order:{id})
 *
 * Run `CACHE_ENABLED=false` on the app to get the "cache off" arm of an A/B —
 * see ops/cache-ab.sh, which runs both arms against fresh app processes and
 * prints the comparison.
 *
 * Every measured request is read-only and idempotent, so runs can be repeated
 * without resetting state. With LOAD_TEST_OUTPUT set, `handleSummary` writes
 * the same report shape ops/format-benchmark.ts consumes for the CI trend
 * charts.
 */

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || 'http://localhost:3000';
const DURATION_SECONDS = Number(__ENV.LOAD_TEST_DURATION_SECONDS || 15);
const VUS = Number(__ENV.LOAD_TEST_CONNECTIONS || 20);
const SEED_ORDERS = Number(__ENV.LOAD_TEST_SEED_ORDERS || 5);
const OUTPUT_PATH = __ENV.LOAD_TEST_OUTPUT;
/** Pause between scenarios so one's tail doesn't bleed into the next. */
const GAP_SECONDS = 2;

const ENDPOINTS = [
  { key: 'health', label: 'GET /health (unauthenticated baseline)', path: '/health', auth: false },
  { key: 'products', label: 'GET /products (authenticated, DB-backed)', path: '/products', auth: true },
  { key: 'orders_list', label: 'GET /orders (authenticated, cache-aside list)', path: '/orders', auth: true },
  { key: 'order_by_id', label: 'GET /orders/:id (authenticated, cache-aside by id)', path: '/orders/:id', auth: true },
];

const scenarios = {};
const thresholds = {};
ENDPOINTS.forEach((endpoint, i) => {
  scenarios[endpoint.key] = {
    executor: 'constant-vus',
    exec: 'hit',
    vus: VUS,
    duration: `${DURATION_SECONDS}s`,
    startTime: `${i * (DURATION_SECONDS + GAP_SECONDS)}s`,
    env: { ENDPOINT: endpoint.key },
    tags: { endpoint: endpoint.key },
  };
  // Thresholds on tagged sub-metrics are what make k6 report per-endpoint
  // stats in the summary; the bounds themselves are permissive on purpose —
  // only errors fail the run, latency is tracked as a trend, not gated.
  thresholds[`http_req_duration{endpoint:${endpoint.key}}`] = ['max>=0'];
  thresholds[`http_reqs{endpoint:${endpoint.key}}`] = ['count>=0'];
  thresholds[`http_req_failed{endpoint:${endpoint.key}}`] = ['rate==0'];
});

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '120s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(97.5)', 'p(99)'],
};

function json(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return http.request(method, `${BASE_URL}${path}`, body ? JSON.stringify(body) : null, {
    headers,
    tags: { endpoint: 'setup' },
  });
}

function waitFor(description, predicate, timeoutSeconds = 30) {
  for (let i = 0; i < timeoutSeconds * 4; i += 1) {
    if (predicate()) return;
    sleep(0.25);
  }
  fail(`Timed out waiting for ${description}`);
}

function orderStatus(token, id) {
  const response = json('GET', `/orders/${id}`, null, token);
  return response.status === 200 ? response.json('status') : undefined;
}

/** Cart → checkout → RESERVED → pay → COMPLETED, through the real consumers. */
function completeOrder(token, productId) {
  const added = json('POST', '/cart/items', { productId, quantity: 1 }, token);
  if (added.status !== 200 && added.status !== 201) fail(`add to cart: ${added.status} ${added.body}`);
  const checkout = json('POST', '/cart/checkout', null, token);
  if (checkout.status !== 200 && checkout.status !== 201) fail(`checkout: ${checkout.status} ${checkout.body}`);
  const id = checkout.json('id');

  waitFor(`order ${id} RESERVED`, () => orderStatus(token, id) === 'RESERVED');
  const pay = json('POST', `/orders/${id}/pay`, null, token);
  if (pay.status !== 200) fail(`pay: ${pay.status} ${pay.body}`);
  waitFor(`order ${id} COMPLETED`, () => orderStatus(token, id) === 'COMPLETED');
  return id;
}

export function setup() {
  waitFor(`${BASE_URL}/health`, () => {
    try {
      return http.get(`${BASE_URL}/health`, { tags: { endpoint: 'setup' } }).status === 200;
    } catch {
      return false;
    }
  }, 60);

  const email = `load-test-${Date.now()}@example.com`;
  const password = 'LoadTest#2026!';
  const registered = json('POST', '/auth/register', { email, password });
  if (registered.status !== 201) fail(`register: ${registered.status} ${registered.body}`);
  const login = json('POST', '/auth/login', { email, password });
  if (login.status !== 200) fail(`login: ${login.status} ${login.body}`);
  const token = login.json('accessToken');

  const products = json('GET', '/products', null, token).json();
  const product = products.find((p) => p.stock >= SEED_ORDERS);
  if (!product) fail('no product with enough stock to seed orders');

  const orderIds = [];
  for (let i = 0; i < SEED_ORDERS; i += 1) {
    orderIds.push(completeOrder(token, product.id));
  }
  return { token, orderId: orderIds[0] };
}

export function hit(data) {
  const endpoint = ENDPOINTS.find((e) => e.key === __ENV.ENDPOINT);
  const path = endpoint.path.replace(':id', data.orderId);
  const params = endpoint.auth ? { headers: { Authorization: `Bearer ${data.token}` } } : {};
  const response = http.get(`${BASE_URL}${path}`, params);
  check(response, { 'status is 200': (r) => r.status === 200 });
}

function endpointScore(data, endpoint) {
  const tag = `{endpoint:${endpoint.key}}`;
  const duration = data.metrics[`http_req_duration${tag}`].values;
  const requests = data.metrics[`http_reqs${tag}`].values.count;
  const failedRate = data.metrics[`http_req_failed${tag}`].values.rate;
  const round = (n) => Number(n.toFixed(2));
  return {
    label: endpoint.label,
    path: endpoint.path,
    requestsPerSec: Number((requests / DURATION_SECONDS).toFixed(1)),
    latency: {
      p50: round(duration.med),
      p90: round(duration['p(90)']),
      p97_5: round(duration['p(97.5)']),
      p99: round(duration['p(99)']),
    },
    non2xx: Math.round(failedRate * requests),
    errors: 0,
  };
}

export function handleSummary(data) {
  const scores = ENDPOINTS.map((endpoint) => endpointScore(data, endpoint));
  const lines = [
    `Load-tested ${BASE_URL} (${VUS} VUs, ${DURATION_SECONDS}s per endpoint)`,
    ...scores.map(
      (s) =>
        `\n${s.label}\n  req/sec:  ${s.requestsPerSec}\n  latency:  p50 ${s.latency.p50}ms  p90 ${s.latency.p90}ms  p97.5 ${s.latency.p97_5}ms  p99 ${s.latency.p99}ms` +
        (s.non2xx > 0 ? `\n  ⚠ non-2xx responses: ${s.non2xx}` : ''),
    ),
    '',
  ];
  const outputs = { stdout: lines.join('\n') };
  if (OUTPUT_PATH) {
    const report = {
      generatedAt: new Date().toISOString(),
      commit: __ENV.GITHUB_SHA || null,
      config: { baseUrl: BASE_URL, connections: VUS, durationSeconds: DURATION_SECONDS },
      endpoints: scores,
    };
    outputs[OUTPUT_PATH] = `${JSON.stringify(report, null, 2)}\n`;
  }
  return outputs;
}
