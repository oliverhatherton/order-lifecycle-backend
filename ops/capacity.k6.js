/* global __ENV, __VU */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

/**
 * Capacity test: how many concurrent shoppers one instance holds before tail
 * latency or errors break. Unlike ops/load-test.k6.js (a closed loop on one
 * read endpoint at a time), every VU here is a shopper with its own account,
 * pausing 1–3 s between requests over keep-alive connections, with a
 * realistic mix: browse products, look at the cart and orders, change cart
 * quantities, and sometimes check out and pay.
 *
 * Load steps up through CAP_STEPS (concurrent shoppers), CAP_STEP_SECONDS
 * each; every step is reported on its own against the pass criteria
 * (p95 < 500 ms, p99 < 1 s, errors < 1%).
 *
 *   CAP_STEPS=100,250,500,1000 CAP_STEP_SECONDS=60 k6 run ops/capacity.k6.js
 */

const BASE_URL = __ENV.CAP_BASE_URL || 'http://localhost:3000';
const STEPS = (__ENV.CAP_STEPS || '100,250,500,1000').split(',').map(Number);
const STEP_SECONDS = Number(__ENV.CAP_STEP_SECONDS || 60);
const PASSWORD = 'Capacity#Shopper2026';
const SHOPPERS = Math.max(...STEPS);
const GAP_SECONDS = 5;

const scenarios = {};
const thresholds = {};
let start = 0;
for (const vus of STEPS) {
  const step = `vus_${vus}`;
  scenarios[step] = {
    executor: 'constant-vus',
    exec: 'shop',
    vus,
    duration: `${STEP_SECONDS}s`,
    startTime: `${start}s`,
    gracefulStop: '5s',
    tags: { step },
  };
  start += STEP_SECONDS + GAP_SECONDS;
  // Per-step sub-metrics; the run itself isn't gated, each step is judged in the summary.
  thresholds[`http_req_duration{step:${step}}`] = ['max>=0'];
  thresholds[`http_reqs{step:${step}}`] = ['count>=0'];
  thresholds[`http_req_failed{step:${step}}`] = ['rate>=0'];
}

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '600s',
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return ['POST', `${BASE_URL}${path}`, body ? JSON.stringify(body) : null, { headers, tags: { step: 'setup' } }];
}

/** Registers and logs in one account per concurrent shopper, in parallel batches. */
export function setup() {
  const run = Date.now();
  const tokens = [];
  for (let i = 0; i < SHOPPERS; i += 50) {
    const emails = [];
    for (let j = i; j < Math.min(i + 50, SHOPPERS); j += 1) emails.push(`capacity-${run}-${j}@example.test`);
    http.batch(emails.map((email) => post('/auth/register', { email, password: PASSWORD })));
    const logins = http.batch(emails.map((email) => post('/auth/login', { email, password: PASSWORD })));
    for (const res of logins) {
      if (res.status !== 200) fail(`login: ${res.status} ${res.body}`);
      tokens.push(res.json('accessToken'));
    }
  }
  const products = http
    .get(`${BASE_URL}/products`, { headers: { Authorization: `Bearer ${tokens[0]}` } })
    .json()
    .map((p) => p.id);
  return { tokens, products };
}

function think() {
  sleep(1 + Math.random() * 2);
}

export function shop(data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const params = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  const ok = (res, name) => check(res, { [name]: (r) => r.status >= 200 && r.status < 300 });
  const pick = () => data.products[Math.floor(Math.random() * data.products.length)];

  ok(http.get(`${BASE_URL}/products`, params), 'products');
  think();
  ok(http.get(`${BASE_URL}/cart`, params), 'cart');
  think();
  ok(http.post(`${BASE_URL}/cart/items`, JSON.stringify({ productId: pick(), quantity: 1 + Math.floor(Math.random() * 2) }), params), 'set item');
  think();
  ok(http.get(`${BASE_URL}/orders`, params), 'orders');
  think();

  // About one session in four checks out and pays.
  if (Math.random() < 0.25) {
    const checkout = http.post(`${BASE_URL}/cart/checkout`, null, params);
    // 409 = stock ran out or the cart emptied — a valid business answer, not a server failure.
    if (checkout.status === 409) return;
    if (!ok(checkout, 'checkout')) return;
    const id = checkout.json('id');
    for (let i = 0; i < 10; i += 1) {
      think();
      const order = http.get(`${BASE_URL}/orders/${id}`, params);
      ok(order, 'order');
      const status = order.status === 200 ? order.json('status') : undefined;
      if (status === 'RESERVED') {
        const pay = http.post(`${BASE_URL}/orders/${id}/pay`, null, params);
        check(pay, { pay: (r) => r.status === 200 || r.status === 409 });
      }
      if (status !== 'PENDING' && status !== 'RESERVED') break;
    }
  }
}

export function handleSummary(data) {
  const lines = [`Capacity test against ${BASE_URL} (${STEP_SECONDS}s per step, 1–3 s think time)`, ''];
  lines.push('shoppers  req/s   p50 ms  p95 ms  p99 ms  errors   pass');
  for (const vus of STEPS) {
    const tag = `{step:vus_${vus}}`;
    const d = data.metrics[`http_req_duration${tag}`]?.values;
    const n = data.metrics[`http_reqs${tag}`]?.values.count ?? 0;
    const failed = data.metrics[`http_req_failed${tag}`]?.values.rate ?? 0;
    if (!d) continue;
    const pass = d['p(95)'] < 500 && d['p(99)'] < 1000 && failed < 0.01;
    lines.push(
      [
        String(vus).padStart(8),
        (n / STEP_SECONDS).toFixed(0).padStart(6),
        d.med.toFixed(0).padStart(7),
        d['p(95)'].toFixed(0).padStart(7),
        d['p(99)'].toFixed(0).padStart(7),
        `${(failed * 100).toFixed(2)}%`.padStart(7),
        pass ? '   yes' : '    NO',
      ].join('  '),
    );
  }
  lines.push('');
  const outputs = { stdout: lines.join('\n') };
  if (__ENV.CAP_OUTPUT) outputs[__ENV.CAP_OUTPUT] = JSON.stringify(data.metrics, null, 2);
  return outputs;
}
