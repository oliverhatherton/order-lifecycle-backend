/* global __ENV, __VU */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Synthetic shopper traffic, so the demo's dashboards (the UI Metrics page,
 * Grafana) show the pipeline doing real work. Unlike ops/load-test.k6.js —
 * which hammers read endpoints to measure capacity — this paces realistic
 * sessions: log in, browse, fill a cart, check out, wait for reservation,
 * then mostly pay (or sometimes cancel) and poll until the order settles.
 *
 * Every request is identifiable as synthetic: an `X-Traffic-Source:
 * synthetic` header, a `order-lifecycle-traffic-sim` User-Agent, and
 * shoppers registered as sim-shopper-<n>@synthetic.example. Treat what it
 * produces as simulated load, not usage.
 *
 *   SIM_BASE_URL=https://api.example.com k6 run ops/traffic-sim.k6.js
 *
 * Env (all optional):
 *   SIM_BASE_URL          target API (default http://localhost:3000)
 *   SIM_SESSIONS_PER_MIN  shopper sessions started per minute (default 3)
 *   SIM_DURATION          how long to run, k6 duration syntax (default 30m)
 *   SIM_SHOPPERS          synthetic accounts = max concurrent sessions (default 5)
 *   SIM_PASSWORD          password for the synthetic accounts
 *
 * Each VU is pinned to its own shopper: a user has a single open cart, so two
 * sessions sharing an account would race each other's checkout.
 */

const BASE_URL = __ENV.SIM_BASE_URL || 'http://localhost:3000';
const SESSIONS_PER_MIN = Number(__ENV.SIM_SESSIONS_PER_MIN || 3);
const DURATION = __ENV.SIM_DURATION || '30m';
const SHOPPERS = Number(__ENV.SIM_SHOPPERS || 5);
const PASSWORD = __ENV.SIM_PASSWORD || 'Synthetic#Shopper2026';

/** What a session does once it has reserved an order. Must sum to 1. */
const AFTER_RESERVE = { pay: 0.85, cancel: 0.15 };
/** Share of sessions that only browse and never check out. */
const BROWSE_ONLY = 0.3;
/** Share of sessions that rotate their refresh token mid-session. */
const REFRESH = 0.2;

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'order-lifecycle-traffic-sim/1.0',
  'X-Traffic-Source': 'synthetic',
};

const sessions = new Counter('sim_sessions');
const ordersPlaced = new Counter('sim_orders_placed');
const ordersCompleted = new Counter('sim_orders_completed');
const ordersCancelled = new Counter('sim_orders_cancelled');
const ordersFailed = new Counter('sim_orders_failed');
const ordersStuck = new Counter('sim_orders_stuck');

export const options = {
  scenarios: {
    shoppers: {
      executor: 'constant-arrival-rate',
      rate: SESSIONS_PER_MIN,
      timeUnit: '1m',
      duration: DURATION,
      // Capped at the shopper pool so no two VUs ever share an account; if
      // every shopper is mid-session, k6 skips that arrival (dropped_iterations).
      preAllocatedVUs: SHOPPERS,
      maxVUs: SHOPPERS,
    },
  },
  thresholds: {
    // Gentle traffic should essentially never fail; flag it if it does.
    'checks{check:request ok}': ['rate>0.98'],
  },
};

function shopperEmail(n) {
  return `sim-shopper-${n}@synthetic.example`;
}

function request(method, path, body, token, name) {
  const headers = token ? { ...HEADERS, Authorization: `Bearer ${token}` } : HEADERS;
  const response = http.request(method, `${BASE_URL}${path}`, body ? JSON.stringify(body) : null, {
    headers,
    tags: { name: name || `${method} ${path}` },
  });
  check(response, { 'request ok': (r) => r.status >= 200 && r.status < 300 });
  return response;
}

/** Human-ish pause between actions. */
function think(min = 1, max = 4) {
  sleep(min + Math.random() * (max - min));
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/** Polls an order until it leaves `fromStatus`, or gives up after `timeoutSeconds`. */
function waitWhile(token, id, fromStatuses, timeoutSeconds = 20) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let status;
  while (Date.now() < deadline) {
    const response = request('GET', `/orders/${id}`, null, token, 'GET /orders/:id');
    status = response.status === 200 ? response.json('status') : undefined;
    if (status && !fromStatuses.includes(status)) return status;
    sleep(1);
  }
  return status;
}

/** Registers the shopper pool once; an account that already exists is fine. */
export function setup() {
  for (let n = 1; n <= SHOPPERS; n += 1) {
    const response = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify({ email: shopperEmail(n), password: PASSWORD }),
      { headers: HEADERS, tags: { name: 'POST /auth/register' } },
    );
    if (response.status !== 201 && response.status !== 409) {
      throw new Error(`could not register ${shopperEmail(n)}: ${response.status} ${response.body}`);
    }
  }
}

export default function shopperSession() {
  sessions.add(1);
  const email = shopperEmail(((__VU - 1) % SHOPPERS) + 1);

  const login = request('POST', '/auth/login', { email, password: PASSWORD }, null);
  if (login.status !== 200) return;
  let token = login.json('accessToken');
  think();

  const productsResponse = request('GET', '/products', null, token);
  if (productsResponse.status !== 200) return;
  const inStock = productsResponse.json().filter((p) => p.stock > 2);
  think(2, 6);

  if (Math.random() < REFRESH) {
    // The refresh cookie rides along in this VU's cookie jar.
    const refreshed = request('POST', '/auth/refresh', null, null);
    if (refreshed.status === 200) token = refreshed.json('accessToken');
  }

  request('GET', '/orders', null, token);
  if (Math.random() < BROWSE_ONLY || inStock.length === 0) return;
  think();

  // Fill the cart: 1–3 distinct products, sometimes changing their mind.
  const lines = Math.min(inStock.length, 1 + Math.floor(Math.random() * 3));
  const chosen = [];
  for (let i = 0; i < lines; i += 1) {
    const product = pick(inStock.filter((p) => !chosen.includes(p.id)));
    chosen.push(product.id);
    request('POST', '/cart/items', { productId: product.id, quantity: 1 + Math.floor(Math.random() * 2) }, token);
    think(1, 3);
  }
  if (chosen.length > 1 && Math.random() < 0.2) {
    request('DELETE', `/cart/items/${chosen.pop()}`, null, token, 'DELETE /cart/items/:productId');
    think(1, 2);
  }
  request('GET', '/cart', null, token);
  think();

  const checkout = request('POST', '/cart/checkout', null, token);
  if (checkout.status !== 200 && checkout.status !== 201) return;
  ordersPlaced.add(1);
  const id = checkout.json('id');

  const reserved = waitWhile(token, id, ['PENDING']);
  if (reserved === 'FAILED') {
    ordersFailed.add(1); // e.g. stock ran out between browsing and reservation
    return;
  }
  if (reserved !== 'RESERVED') {
    ordersStuck.add(1);
    return;
  }
  think(2, 8); // reviewing the order before paying

  if (Math.random() < AFTER_RESERVE.cancel) {
    const cancelled = request('POST', `/orders/${id}/cancel`, null, token, 'POST /orders/:id/cancel');
    if (cancelled.status === 200) ordersCancelled.add(1);
    return;
  }

  const paid = request('POST', `/orders/${id}/pay`, null, token, 'POST /orders/:id/pay');
  if (paid.status !== 200) return;
  const settled = waitWhile(token, id, ['RESERVED', 'PAID']);
  if (settled === 'COMPLETED') ordersCompleted.add(1);
  else if (settled === 'FAILED') ordersFailed.add(1);
  else ordersStuck.add(1);
}
