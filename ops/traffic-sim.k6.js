/* global __ENV, __VU */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Synthetic shopper traffic, so the demo's dashboards (the UI Metrics page,
 * Grafana) show the pipeline doing real work. Unlike ops/load-test.k6.js —
 * which hammers read endpoints to measure capacity — this paces realistic
 * sessions, shaped like a real shop's traffic:
 *
 *   - Time of day: arrivals follow a UK shopping day (quiet overnight, a
 *     lunchtime bump, the peak in the evening), a little busier at weekends.
 *   - Within a run: the rate wanders minute to minute, and about one run in
 *     four has a short rush, like a promo email landing.
 *   - Who arrives: most sessions never buy. Bouncers glance at the catalog
 *     and leave, browsers look around for a while, abandoners fill a cart and
 *     walk away (the cart is still there next visit), buyers check out and
 *     mostly pay, and returning customers only check on an order.
 *   - Pauses: long-tailed (most a few seconds, some much longer), not uniform.
 *
 * Every request is identifiable as synthetic: an `X-Traffic-Source:
 * synthetic` header, a `order-lifecycle-traffic-sim` User-Agent, and
 * shoppers registered as sim-shopper-<n>@synthetic.example. Treat what it
 * produces as simulated load, not usage.
 *
 *   SIM_BASE_URL=https://api.example.com k6 run ops/traffic-sim.k6.js
 *
 * Env (all optional):
 *   SIM_BASE_URL                target API (default http://localhost:3000)
 *   SIM_PEAK_SESSIONS_PER_MIN   sessions per minute at the evening peak (default 4)
 *   SIM_DURATION                how long to run, in minutes or as e.g. `12m` (default 30)
 *   SIM_SHOPPERS                synthetic accounts = max concurrent sessions (default 12)
 *   SIM_HOUR                    UK hour (0–23) to shape the run for; default is now
 *   SIM_SEED                    makes a run's shape repeatable
 *   SIM_PASSWORD                password for the synthetic accounts
 *
 * Each VU is pinned to its own shopper: a user has a single open cart, so two
 * sessions sharing an account would race each other's checkout.
 */

const BASE_URL = __ENV.SIM_BASE_URL || 'http://localhost:3000';
const PEAK_PER_MIN = Number(__ENV.SIM_PEAK_SESSIONS_PER_MIN || 4);
const DURATION_MINUTES = Math.max(3, parseInt(__ENV.SIM_DURATION || '30', 10));
const SHOPPERS = Number(__ENV.SIM_SHOPPERS || 12);
const PASSWORD = __ENV.SIM_PASSWORD || 'Synthetic#Shopper2026';

/** Share of the evening peak for each UK hour, 00:00 to 23:00. */
const HOURLY_SHAPE = [
  0.1, 0.06, 0.04, 0.03, 0.03, 0.05, 0.12, 0.25, 0.4, 0.5, 0.55, 0.62,
  0.75, 0.7, 0.58, 0.55, 0.58, 0.68, 0.85, 1, 0.95, 0.78, 0.5, 0.25,
];
/** Sunday to Saturday. */
const WEEKDAY_SHAPE = [1.15, 0.9, 0.9, 0.95, 1, 0.95, 1.1];

/** Who a session is. Weights sum to 1. */
const KINDS = [
  { kind: 'bounce', weight: 0.3 },
  { kind: 'browse', weight: 0.25 },
  { kind: 'abandon', weight: 0.2 },
  { kind: 'buy', weight: 0.2 },
  { kind: 'returning', weight: 0.05 },
];
/** Share of reserved orders the buyer cancels instead of paying. */
const CANCEL_AFTER_RESERVE = 0.1;
/** Share of longer sessions that rotate their refresh token mid-session. */
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

/** Small seeded PRNG (mulberry32), so a run's arrival curve can be replayed. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The hour and weekday in the UK: GMT, or BST between the last Sundays of March and October. */
function ukTime(now) {
  const year = now.getUTCFullYear();
  const lastSunday = (month) => {
    const d = new Date(Date.UTC(year, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  };
  const bst = now >= lastSunday(2) && now < lastSunday(9);
  const local = new Date(now.getTime() + (bst ? 3600_000 : 0));
  return { hour: local.getUTCHours(), weekday: local.getUTCDay() };
}

/**
 * Sessions per minute for each minute of the run: the time-of-day rate,
 * drifting ±40% minute to minute, sometimes with a two-minute rush, and
 * easing out at the end.
 */
function arrivalCurve() {
  const random = seededRandom(Number(__ENV.SIM_SEED || Math.floor(Date.now() / 60_000)));
  const uk = ukTime(new Date());
  const hour = __ENV.SIM_HOUR !== undefined ? Number(__ENV.SIM_HOUR) : uk.hour;
  const base = PEAK_PER_MIN * HOURLY_SHAPE[hour] * WEEKDAY_SHAPE[uk.weekday];

  const hasRush = random() < 0.25;
  const rushAt = 1 + Math.floor(random() * (DURATION_MINUTES - 3));
  const perMinute = [];
  let drift = 1;
  for (let minute = 0; minute < DURATION_MINUTES; minute += 1) {
    drift = Math.min(1.4, Math.max(0.6, drift + (random() - 0.5) * 0.3));
    let rate = base * drift;
    if (hasRush && (minute === rushAt || minute === rushAt + 1)) rate *= 2.5;
    // Each stage ramps to its target, so the first minute already eases in from 0.
    if (minute === DURATION_MINUTES - 1) rate *= 0.5;
    perMinute.push(rate);
  }
  return perMinute;
}

const CURVE = arrivalCurve();

export const options = {
  scenarios: {
    shoppers: {
      executor: 'ramping-arrival-rate',
      // Rates are per 10 minutes so a quiet hour can still be fractional per minute.
      timeUnit: '10m',
      startRate: 0,
      stages: CURVE.map((perMinute) => ({ target: Math.round(perMinute * 10), duration: '1m' })),
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

/**
 * A human pause: log-normal around `median` seconds, so most are short and a
 * few are long (reading a product, getting distracted). Capped at 30 s.
 */
function think(median = 3) {
  const z = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  sleep(Math.min(30, Math.max(0.5, median * Math.exp(0.6 * z))));
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickKind() {
  let roll = Math.random();
  for (const { kind, weight } of KINDS) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return KINDS[0].kind;
}

/** Polls an order until it leaves `fromStatuses`, or gives up after `timeoutSeconds`. */
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
  const sessionsPlanned = CURVE.reduce((sum, perMinute) => sum + perMinute, 0);
  console.log(
    `Shaping ${DURATION_MINUTES} min at ${CURVE.map((r) => r.toFixed(1)).join(' ')} sessions/min (~${Math.round(sessionsPlanned)} sessions)`,
  );
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

/** Adds 1–3 in-stock products; sometimes changes a quantity or removes one. */
function fillCart(token, inStock) {
  const lines = Math.min(inStock.length, 1 + Math.floor(Math.random() * 3));
  const chosen = [];
  for (let i = 0; i < lines; i += 1) {
    const product = pick(inStock.filter((p) => !chosen.includes(p.id)));
    chosen.push(product.id);
    request('POST', '/cart/items', { productId: product.id, quantity: 1 + Math.floor(Math.random() * 2) }, token);
    think(2);
  }
  if (Math.random() < 0.25) {
    request('POST', '/cart/items', { productId: pick(chosen), quantity: 1 + Math.floor(Math.random() * 3) }, token);
    think(1.5);
  }
  if (chosen.length > 1 && Math.random() < 0.2) {
    request('DELETE', `/cart/items/${chosen.pop()}`, null, token, 'DELETE /cart/items/:productId');
    think(1.5);
  }
  request('GET', '/cart', null, token);
}

/** Checks out, then mostly pays (sometimes cancels) and follows the order to the end. */
function buy(token) {
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
  think(5); // reviewing the order before paying

  if (Math.random() < CANCEL_AFTER_RESERVE) {
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

export default function shopperSession() {
  const kind = pickKind();
  sessions.add(1, { kind });
  const email = shopperEmail(((__VU - 1) % SHOPPERS) + 1);

  const login = request('POST', '/auth/login', { email, password: PASSWORD }, null);
  if (login.status !== 200) return;
  let token = login.json('accessToken');
  think(1.5);

  if (kind === 'returning') {
    const orders = request('GET', '/orders', null, token);
    const latest = orders.status === 200 ? orders.json()[0] : undefined;
    if (latest) {
      think(2);
      request('GET', `/orders/${latest.id}`, null, token, 'GET /orders/:id');
    }
    return;
  }

  const productsResponse = request('GET', '/products', null, token);
  if (productsResponse.status !== 200 || kind === 'bounce') return;
  const inStock = productsResponse.json().filter((p) => p.stock > 2);
  think(kind === 'browse' ? 8 : 4);

  if (Math.random() < REFRESH) {
    // The refresh cookie rides along in this VU's cookie jar.
    const refreshed = request('POST', '/auth/refresh', null, null);
    if (refreshed.status === 200) token = refreshed.json('accessToken');
  }

  if (kind === 'browse') {
    if (Math.random() < 0.5) {
      request('GET', '/products', null, token);
      think(6);
    }
    request('GET', '/cart', null, token);
    if (Math.random() < 0.5) {
      think(3);
      request('GET', '/orders', null, token);
    }
    return;
  }

  if (inStock.length === 0) return;
  fillCart(token, inStock);
  think(4);
  if (kind === 'buy') buy(token);
}
