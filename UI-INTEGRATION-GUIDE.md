# UI Integration Guide — Order Lifecycle Backend

A complete guide for building a UI that demonstrates the capabilities of this order lifecycle backend. This system features JWT auth, event-driven async order fulfilment, and comprehensive observability.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication Flow](#authentication-flow)
3. [API Integration Patterns](#api-integration-patterns)
4. [Order Lifecycle & Polling](#order-lifecycle--polling)
5. [Confirming Payment (the "Pay" button)](#confirming-payment-the-pay-button)
6. [Real-Time State Simulation](#real-time-state-simulation)
7. [Error Handling & Recovery](#error-handling--recovery)
8. [Admin Panel](#admin-panel)
9. [Observability Integration](#observability-integration)
10. [Metrics History (Durable, Resolution-Bucketed)](#metrics-history-durable-resolution-bucketed)
11. [Example Implementation (React)](#example-implementation-react)
12. [Demo Scenarios](#demo-scenarios)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           UI (Browser)                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Auth Module     │  │  Orders Module   │  │ Admin Panel  │  │
│  │  (Login/Signup)  │  │  (Create/Track)  │  │  (Manage)    │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└────────┬─────────────────────────────────────────────────────┬──┘
         │ HTTP + Cookies (credentials: include)              │
         ▼                                                     ▼
    ┌──────────────────────────────────────────────────────────────┐
    │            NestJS REST API (Base: /)                          │
    │  ┌─────────────────────────────────────────────────────────┐  │
    │  │ Auth Endpoints            │ Order Endpoints             │  │
    │  │ ├─ POST /auth/register    │ ├─ POST /orders            │  │
    │  │ ├─ POST /auth/login       │ ├─ GET  /orders            │  │
    │  │ ├─ POST /auth/refresh     │ ├─ GET  /orders/:id        │  │
    │  │ ├─ GET  /auth/me          │ └─ POST /orders/:id/pay    │  │
    │  │ └─                         │                            │  │
    │  │ Admin Endpoints            │ Observability             │  │
    │  │ ├─ GET  /admin/users      │ ├─ GET  /health           │  │
    │  │ ├─ PATCH /admin/users/:id │ ├─ GET  /metrics (Prom)   │  │
    │  │ └─ /disable|enable        │ ├─ GET  /metrics/history  │  │
    │  │                            │ └─ Tracing (OTEL)         │  │
    │  └─────────────────────────────────────────────────────────┘  │
    │                                                                 │
    │  ┌─────────────────────────────────────────────────────────┐  │
    │  │ Backing Services                                         │  │
    │  │  ├─ PostgreSQL (Order, User, Auth, Payment, Metric      │  │
    │  │  │   history records)                                   │  │
    │  │  ├─ RabbitMQ (Event-driven async fulfilment)           │  │
    │  │  └─ Redis (Order status cache, read-through)           │  │
    │  └─────────────────────────────────────────────────────────┘  │
    │                                                                 │
    │  ┌─────────────────────────────────────────────────────────┐  │
    │  │ Async Event Chain (RabbitMQ consumers)                  │  │
    │  │  order.created ──▶ [inventory] ──▶ order RESERVED       │  │
    │  │                                        │                 │  │
    │  │                          ⏸  PAUSED — waits here for      │  │
    │  │                          POST /orders/:id/pay (the UI's  │  │
    │  │                          simulated "Pay" button)         │  │
    │  │                                        │                 │  │
    │  │                                        ▼                 │  │
    │  │                                    [payment]  ──▶ order_ │  │
    │  │                                                  payment_ │  │
    │  │                                                  processed │  │
    │  │                                        │                 │  │
    │  │                                        ▼                 │  │
    │  │                                   [completion] ──▶ order │  │
    │  │                                                  _completed │  │
    │  │                                                           │  │
    │  │  (Each step updates DB, order status advances)           │  │
    │  └─────────────────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**
- **No WebSockets**: Status updates are polled (simpler, stateless backend)
- **Event-Driven Backend, with one manual gate**: Reservation happens automatically; the order then pauses in RESERVED until the caller calls `POST /orders/:id/pay` (the UI's simulated "Pay" button), which resumes the async chain
- **Durable metric history**: `/metrics` (Prometheus) is in-memory and resets on restart; `/metrics/history` is backed by a Postgres table and survives restarts, pre-aggregated by resolution so responses stay small
- **Httponly Cookies**: Refresh token is never exposed to JavaScript
- **Access Token in Memory**: Limits XSS blast radius
- **CORS & Cookies**: Supports both same-origin and cross-origin deployments
- **Idempotency**: Payment authorization is idempotent per order (safe to retry); the pay endpoint itself is idempotent too — a double-click can't double-charge

---

## Authentication Flow

### 1. Token Model

| Component | Storage | Lifetime | Purpose | Sent How |
|-----------|---------|----------|---------|----------|
| **Access Token** (JWT) | Memory (React state) | 15 min (default) | API calls | `Authorization: Bearer <token>` |
| **Refresh Token** | HttpOnly Cookie | 7 days (default), rotated on use | Automatic refresh | Browser auto-sends to `/auth/refresh` |

### 2. Login → Token Bootstrap

```
User submits {email, password}
         │
         ▼
POST /auth/login {email, password}
         │
         ├─ 200: { accessToken: "..." }
         │         + Set-Cookie: refresh_token=...; HttpOnly; Path=/auth/refresh
         │
         └─ 401: Invalid credentials (generic, no user enumeration)
         
Frontend: Store accessToken in memory (e.g., React state), browser auto-stores cookie.
```

**Why this split?**
- Access token in memory: If the frontend is XSS'd, the attacker can't read the refresh token from `localStorage`.
- Refresh token as httpOnly cookie: JavaScript can never read it (even if XSS'd).
- Rotation on refresh: If a refresh token is reused (stolen and replayed), the family is revoked, detecting the theft.

### 3. Session Refresh (Automatic)

```
On any 401 from a protected endpoint:

1. POST /auth/refresh (no body, cookie rides along auto)
2. Receive: { accessToken: "..." } + new Set-Cookie header
3. Update in-memory token
4. Retry the original request

If refresh also returns 401: cookie is missing, invalid, or reused → send to login.
```

**Important**: Use a shared "refresh in-flight" promise to avoid stampeding (multiple parallel requests all trying to refresh at once).

### 4. Logout

```
Clear the in-memory token. The httpOnly cookie will naturally expire after 7 days (or on server revocation).
To revoke immediately: The server tracks token families on reuse — if a refresh token is reused, 
the entire family is invalidated.
```

### 5. CORS & Cross-Origin Setup

**Same-origin deployment (UI and API share domain):**
- Leave `CORS_ORIGIN` unset.
- Leave `COOKIE_SAMESITE=strict` (default).
- Use `credentials: 'include'` in fetch (for the refresh cookie).

**Cross-origin deployment (UI on `demo.example.com`, API on `api.example.com`):**
- Set `CORS_ORIGIN=https://demo.example.com` (exact) or `https://*.example.com` (wildcard).
- Set `COOKIE_SAMESITE=none` (HTTPS required).
- Use `credentials: 'include'` in fetch.

---

## API Integration Patterns

### Base URL and Route Structure

```
Base URL: http://localhost:3000 (or your deployed domain)
No global route prefix — endpoints live at:
  /auth/*        — authentication
  /orders/*      — order operations
  /admin/*       — admin operations
  /health        — liveness check
  /metrics       — Prometheus exposition
  /docs          — Swagger UI (interactive API reference)
```

### Standard Request/Response Pattern

```
Request:
  GET/POST/PATCH <endpoint>
  Headers:
    Authorization: Bearer <accessToken>        (for protected endpoints)
    Content-Type: application/json              (for POST/PATCH)
    X-Correlation-ID: <uuid>                   (optional, server generates if missing)
    (+ httpOnly cookies sent auto for /auth/refresh)

Response (success):
  200/201
  {
    "id": "uuid",
    "...": "..."
  }
  Headers:
    X-Correlation-ID: <uuid>  (echo of request or server-generated)

Response (error):
  4xx/5xx
  {
    "statusCode": <number>,
    "message": "<string or [array of strings]>",   // [array] on 400 (validation)
    "error": "<type>"
  }
  Headers:
    X-Correlation-ID: <uuid>
```

### Error Codes & Recovery

| Code | Scenario | Recovery |
|------|----------|----------|
| `200/201` | Success | Use response. |
| `400` | Validation failed | `message` is an array of field errors. Show to user. |
| `401` | Missing/invalid token | Call `POST /auth/refresh`; if also 401, send to login. |
| `403` | Not admin (admin endpoints only) | Show 403 error, no retry. |
| `404` | Resource not found or not yours | Order/user does not exist or is not yours. Show error. |
| `409` | Conflict (duplicate email) | Email already registered. Prompt user to login or try another. |
| `5xx` | Server error | Backoff and retry (with exponential delay). |

---

## Order Lifecycle & Polling

### 1. Order State Machine

```
Happy path:
  PENDING ──[inventory reserve, automatic]──> RESERVED
                                                  │
                                    ⏸  PAUSED — waits for the caller to
                                    POST /orders/:id/pay (simulated "Pay")
                                                  │
                                                  ▼
                                    ──[payment auth]──> PAID ──[fulfil]──> COMPLETED

Failure paths:
  PENDING ──[inventory fails]──> FAILED
  RESERVED ──[payment fails, only after /pay is called]──> FAILED

Terminal states: COMPLETED, FAILED (no outgoing transitions)
```

**RESERVED is now a real pause, not a transient state.** Inventory reservation
still happens automatically and immediately after `POST /orders`. But nothing
advances the order past RESERVED until the UI calls
`POST /orders/{id}/pay` — an order can sit in RESERVED indefinitely with no
background process touching it. This is what makes the "Pay" button
meaningful: it's the one thing that unblocks payment authorization and
fulfilment, not just a UI affordance layered on top of an already-automatic
flow.

### 2. Creating an Order

```
POST /orders

Request:
  Headers:
    Authorization: Bearer <accessToken>
  Body: (empty)

Response (immediate):
  201
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "...",
    "status": "PENDING",
    "paymentInitiatedAt": null,
    "createdAt": "2026-07-01T14:30:00.000Z",
    "updatedAt": "2026-07-01T14:30:00.000Z"
  }

Returns immediately — inventory reservation runs async in the background and
lands the order in RESERVED within a second or two. Nothing further happens
until the caller confirms payment (see the next section).
```

### 3. Polling for Status

```
After POST /orders, poll GET /orders/:id in a loop until the order reaches
RESERVED (then wait for the "Pay" click), or a terminal state:

while (!isTerminal(order.status) && order.status !== 'RESERVED') {
  await sleep(1000);  // Poll every ~1 second for a few seconds
  order = await fetch(`GET /orders/${orderId}`, { headers: { Authorization: ... }});
}
// order.status is now RESERVED (show the "Pay" button) or FAILED.

Terminal states: COMPLETED, FAILED

Timeline (typical):
  t+0s:   POST /orders            -> { status: "PENDING" }
  t+1s:   GET /orders/:id         -> { status: "RESERVED" }   (inventory done — polling stops here, UI shows "Pay")
  ...     (order waits indefinitely until the user clicks "Pay")
  t+Ns:   POST /orders/:id/pay    -> { status: "RESERVED", paymentInitiatedAt: "..." }  (resumes fulfilment; poll again)
  t+N+1s: GET /orders/:id         -> { status: "PAID" }        (payment done)
  t+N+2s: GET /orders/:id         -> { status: "COMPLETED" }   (fulfillment done)

Variations:
  - Inventory fails:    PENDING -> FAILED (at t+1s)
  - Payment fails:      RESERVED -> FAILED (only after /pay is called)
  - Cache hit:          Status may not advance on every poll (order is still in queue)
  - Server load:        May take longer (RabbitMQ backoff, retries)
```

### 4. Polling Strategy (React Example)

```typescript
const [order, setOrder] = useState<Order | null>(null);
const [isPolling, setIsPolling] = useState(false);

// Stop polling once the order needs a human action (RESERVED, awaiting the
// "Pay" click) or has reached a terminal state.
const isAwaitingAction = (status) =>
  status === 'RESERVED' || isTerminal(status);

const createAndPollOrder = async () => {
  // Create
  const created = await fetch('/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',  // Send refresh cookie
  });
  const order = await created.json();
  setOrder(order);
  setIsPolling(true);

  // Poll until RESERVED (show "Pay") or a terminal state.
  let current = order;
  while (!isAwaitingAction(current.status)) {
    await sleep(1000);
    const resp = await fetch(`/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    });
    
    if (resp.status === 401) {
      // Token expired, refresh
      const refreshed = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const { accessToken: newToken } = await refreshed.json();
      setAccessToken(newToken);
      // Retry the poll
      continue;
    }
    
    if (!resp.ok) break;  // Error
    current = await resp.json();
    setOrder(current);
  }

  setIsPolling(false);
};
```

### 5. Listing Orders

```
GET /orders

Request:
  Headers:
    Authorization: Bearer <accessToken>

Response:
  200
  [
    { "id": "...", "status": "COMPLETED", "createdAt": "...", "updatedAt": "..." },
    { "id": "...", "status": "PENDING", "createdAt": "...", "updatedAt": "..." },
    ...
  ]

Returns the caller's own orders, newest first.
```

---

## Confirming Payment (the "Pay" button)

An order sitting in RESERVED goes nowhere until the caller confirms payment.
This is the hook for a "Pay $X" button in the UI — a real payment provider
never runs (see [Demo Scenarios](#demo-scenarios)), but the *gate* is real:
nothing charges, authorizes, or completes the order until this endpoint is
called.

```
POST /orders/:id/pay

Request:
  Headers:
    Authorization: Bearer <accessToken>
  Body: (empty)

Response (immediate):
  200
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "...",
    "status": "RESERVED",
    "paymentInitiatedAt": "2026-07-01T14:30:05.000Z",
    "createdAt": "...",
    "updatedAt": "..."
  }

Returns immediately with the order still RESERVED — payment authorization
(the same simulated gateway as before) now runs asynchronously. Resume
polling GET /orders/{id} to watch it advance to PAID → COMPLETED, or FAILED
on a simulated decline.

Errors:
  404  Order doesn't exist or isn't the caller's.
  409  Order isn't RESERVED (e.g. still PENDING, or PAID/COMPLETED/FAILED
       already), OR payment was already initiated for it. Safe to treat as
       "nothing to do" — disable the Pay button and keep polling.
```

**Idempotency / double-click safety**: the server claims the order with an
atomic `UPDATE ... WHERE status = 'RESERVED' AND paymentInitiatedAt IS NULL`.
Two concurrent `POST /pay` calls (e.g. a double-click before the button
disables) can only ever have one succeed — the other gets a 409, not a
duplicate charge. The UI doesn't need its own debounce logic to be correct,
though disabling the button on click is still good UX.

```typescript
const payForOrder = async (orderId: string) => {
  const resp = await fetchWithAuth(`/orders/${orderId}/pay`, { method: 'POST' });
  if (resp.status === 409) {
    // Already paid / not reserved anymore — just resume polling, don't show an error.
    return;
  }
  if (!resp.ok) throw new Error('Failed to confirm payment');
  const order = await resp.json();
  setOrder(order); // still RESERVED — resume the polling loop from here
};
```

---

## Real-Time State Simulation

Since there are no WebSockets, the UI can simulate "real-time" updates for a smoother UX:

### Optimistic Status Progression

```typescript
// On POST /orders success, assume the order will progress through states
// This makes the UI feel instant, while the actual server progresses in the background.

const assumedProgression = {
  'PENDING':    { assumeNext: 'RESERVED', delayMs: 1000 },
  // RESERVED no longer auto-advances — it's a real pause waiting on
  // POST /orders/:id/pay, so there's nothing to optimistically assume here.
  'RESERVED':   { assumeNext: null },
  'PAID':       { assumeNext: 'COMPLETED', delayMs: 1000 },
  'COMPLETED': { assumeNext: null },
  'FAILED':     { assumeNext: null },
};

// UI shows the assumed status immediately, but validates with the server
// via polling. If the server disagrees, revert to actual state. Once RESERVED
// is reached, stop assuming and show the "Pay" button instead.
```

### Server Validation with Backoff

```typescript
// Start fast (1s), then back off (2s, 4s, ...) if state doesn't change
let backoffMs = 1000;
const maxBackoff = 16000;

while (!isTerminal(current.status)) {
  await sleep(backoffMs);
  const resp = await fetch(`/orders/${order.id}`, ...);
  const updated = await resp.json();

  if (updated.status !== current.status) {
    // Status advanced, reset backoff
    current = updated;
    backoffMs = 1000;
  } else {
    // Status unchanged, back off
    backoffMs = Math.min(backoffMs * 2, maxBackoff);
  }

  setOrder(current);
}
```

### Loading States for the UI

```
While polling for order status:

While reserving (PENDING → RESERVED):
┌─────────────────────────────────┐
│ Order: #550e8400-e29b-...       │
│                                 │
│ Status: PENDING                 │
│ ┌─────────────────────────────┐ │
│ │ ⏳ Checking inventory...     │ │
│ └─────────────────────────────┘ │
│ [Cancel] [Refresh]              │
└─────────────────────────────────┘

Once RESERVED — waiting for the user, not the server:
┌─────────────────────────────────┐
│ Order: #550e8400-e29b-...       │
│                                 │
│ Status: RESERVED                │
│ ┌─────────────────────────────┐ │
│ │ ✓ Inventory reserved         │ │
│ │ Ready to pay — $42.00        │ │
│ └─────────────────────────────┘ │
│           [ Pay ]                │
└─────────────────────────────────┘

After clicking Pay (PAID → COMPLETED, async again):
┌─────────────────────────────────┐
│ Status: RESERVED (paying...)    │
│ ┌─────────────────────────────┐ │
│ │ ✓ Inventory reserved         │ │
│ │ ⏳ Processing payment...     │ │
│ │ • Finalizing order           │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘

Progress indicators:
  ✓ = COMPLETED/PAID/RESERVED (done)
  ○ = PENDING (next steps)
  ⏸ = RESERVED, awaiting the Pay click
  ✗ = FAILED
```

---

## Error Handling & Recovery

### Transient Errors (Retry)

```typescript
const fetchWithRetry = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status >= 500 || resp.status === 429) {
        // Server error or rate limit, backoff
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      return resp;
    } catch (e) {
      // Network error
      if (i === maxRetries - 1) throw e;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
};
```

### Authorization Errors (Refresh + Retry)

```typescript
const fetchWithRefresh = async (url, options) => {
  let resp = await fetch(url, options);

  if (resp.status === 401) {
    // Try to refresh
    const refreshResp = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshResp.ok) {
      const { accessToken } = await refreshResp.json();
      // Update token in memory
      setAccessToken(accessToken);
      // Retry original request
      options.headers.Authorization = `Bearer ${accessToken}`;
      resp = await fetch(url, options);
    } else {
      // Refresh failed, redirect to login
      redirectToLogin();
    }
  }

  return resp;
};
```

### Validation Errors (Show Field Errors)

```typescript
const handleResponse = async (resp) => {
  if (!resp.ok) {
    const { statusCode, message, error } = await resp.json();

    if (statusCode === 400 && Array.isArray(message)) {
      // Validation errors: message = ["email must be an email", "password too short"]
      return { errors: message };
    }

    if (statusCode === 409) {
      // Conflict (e.g., email already registered)
      return { error: 'Email already in use' };
    }

    if (statusCode === 401) {
      return { error: 'Session expired, please login again' };
    }

    // Other errors
    return { error: `${statusCode}: ${error}` };
  }

  return { data: await resp.json() };
};
```

### Displaying Correlation IDs for Support

```typescript
// Capture the correlation ID from response headers for error reporting
const correlationId = resp.headers.get('x-correlation-id');

if (!resp.ok) {
  const errorMessage = `Error ${resp.status}. Please contact support with ID: ${correlationId}`;
  showErrorToUser(errorMessage);
}

// User can quote this ID to support team for debugging logs/traces
```

---

## Admin Panel

Admin users (role = `ADMIN`) have access to user management.

### 1. List Users

```
GET /admin/users

Request:
  Headers:
    Authorization: Bearer <accessToken>  (from an ADMIN user)

Response:
  200
  [
    { "id": "uuid", "email": "admin@example.com", "role": "ADMIN", "disabled": false, "createdAt": "..." },
    { "id": "uuid", "email": "user@example.com", "role": "USER", "disabled": false, "createdAt": "..." },
  ]

Returns only metadata (never passwords).
Access: ADMIN role required (403 if not admin).
```

### 2. Disable User

```
PATCH /admin/users/:id/disable

Request:
  Headers:
    Authorization: Bearer <accessToken>  (from an ADMIN user)

Response:
  200
  { "id": "uuid", "email": "user@example.com", "role": "USER", "disabled": true, "createdAt": "..." }

Effect: User cannot login or refresh tokens. Existing tokens remain valid until expiry.
```

### 3. Enable User

```
PATCH /admin/users/:id/enable

Request:
  Headers:
    Authorization: Bearer <accessToken>  (from an ADMIN user)

Response:
  200
  { "id": "uuid", "email": "user@example.com", "role": "USER", "disabled": false, "createdAt": "..." }

Reverses a disable.
```

### Admin UI Flow

```
┌──────────────────────────────┐
│ Admin Dashboard              │
├──────────────────────────────┤
│ Users                        │
│ ┌────────────────────────┐   │
│ │ Email      │ Role │Dis │   │
│ ├────────────────────────┤   │
│ │ alice@...  │ADMIN │[X] │   │ <- ADMIN can't disable themselves
│ │ bob@...    │USER  │[◯] │   │ <- Can disable/enable
│ │ charlie@.. │USER  │[✓] │   │ <- Disabled (red badge)
│ └────────────────────────┘   │
│                              │
│ Actions:                     │
│ [Disable] [Enable]           │
└──────────────────────────────┘

Disable: PATCH /admin/users/:id/disable
Enable:  PATCH /admin/users/:id/enable
Refresh: GET /admin/users
```

---

## Observability Integration

### Health Check (Readiness)

```
GET /health

Response:
  200
  (no body, just status)

Use this to:
- Warm up the backend on page load
- Implement a "backend is up" indicator
- Monitor during deployment
```

### Prometheus Metrics

```
GET /metrics

Response:
  200 (Prometheus text format)
  # HELP http_request_duration_seconds HTTP request latency in seconds
  # TYPE http_request_duration_seconds histogram
  http_request_duration_seconds_bucket{le="0.1",method="GET",route="/orders"} 5
  ...

Use this to:
- Build Grafana dashboards
- Monitor request latency, error rates, order throughput
- Spot performance issues

Note: this is the in-memory Prometheus registry — a restart zeroes it, and
it's shaped for a scraper, not a UI chart. For a JSON, durable, chartable
history (what a UI dashboard actually wants), use `GET /metrics/history`
instead — see the next section.
```

### OpenTelemetry Tracing (Optional)

```
On each request, if OTEL_EXPORTER_OTLP_ENDPOINT is configured:
- Traces are exported to a collector (Jaeger, Grafana Cloud, DataDog, etc.)
- Every log and event is stamped with a trace ID
- The X-Correlation-ID header is mapped to the trace ID

Viewing traces:
  1. Send a request with a known correlation ID
  2. Query Jaeger at http://localhost:16686
  3. Filter by trace ID (mapped from correlation ID)
  4. See the full request → inventory → payment → completion chain

Example Jaeger query:
  Search by tag: trace_id=<your-correlation-id>
  View:
    GET /orders (client)
    └─ OrdersService.createOrder
       └─ EventPublisher.publish (order.created)
    (then async, in background)
    └─ InventoryConsumer.handleOrderCreated
       └─ OrdersService.updateStatus (PENDING → RESERVED)
       └─ EventPublisher.publish (order.inventory_reserved)
    └─ PaymentConsumer.handleInventoryReserved
       └─ PaymentGateway.authorize
       └─ OrdersService.updateStatus (RESERVED → PAID)
    └─ CompletionConsumer.handlePaymentProcessed
       └─ OrdersService.updateStatus (PAID → COMPLETED)
```

---

## Metrics History (Durable, Resolution-Bucketed)

Every Prometheus collector in the app (`consumer_messages`,
`consumer_processing_duration_ms`, `orders_terminal`, `db_query_duration_ms`,
`http_request_duration_ms`) is mirrored into a Postgres table (`metric_events`)
as it's recorded. `GET /metrics/history` reads that table — so unlike
`/metrics`, it survives a restart, and a UI dashboard doesn't have to scrape
and store history itself.

### Fetching History

```
GET /metrics/history?metric=<name>&resolution=<res>&from=<iso>&to=<iso>

Request:
  Headers:
    Authorization: Bearer <accessToken>   (any authenticated user)

Query params:
  metric      required. One of:
                consumer_messages
                consumer_processing_duration_ms
                orders_terminal
                db_query_duration_ms
                http_request_duration_ms
  resolution  optional, default "raw". One of:
                raw | 1h | 6h | 12h | 1d | 1w | 1mo
  from        optional. ISO-8601 start of the window (inclusive).
  to          optional. ISO-8601 end of the window (inclusive), default now.

Response:
  200
  {
    "metric": "orders_terminal",
    "resolution": "1h",
    "points": [
      { "bucketStart": "2026-07-01T12:00:00.000Z", "count": 8, "sum": 8, "avg": 1, "min": 1, "max": 1 },
      { "bucketStart": "2026-07-01T13:00:00.000Z", "count": 3, "sum": 3, "avg": 1, "min": 1, "max": 1 },
      ...
    ]
  }
```

### Reading a point: counters vs. durations

Each point aggregates every sample that fell in its bucket. Which field to
chart depends on the metric:

| Metric | What it means | Chart with |
|---|---|---|
| `orders_terminal` | Orders reaching COMPLETED/FAILED | `sum` (or `count` — identical, each sample is 1) |
| `consumer_messages` | Messages a consumer processed/skipped/retried/failed | `sum` |
| `db_query_duration_ms` | DB operation latency | `avg` (or `max` for a worst-case line) |
| `consumer_processing_duration_ms` | Time a consumer spent per message | `avg` |
| `http_request_duration_ms` | HTTP request latency | `avg` |

### Resolutions — why the response stays small

| Resolution | Bucket width | Default window (if `from` omitted) | Typical point count |
|---|---|---|---|
| `raw` | none (individual samples) | last 1 hour | ≤ 500 (capped, most recent) |
| `1h` | 1 hour | last 24 hours | ≤ 24 |
| `6h` | 6 hours | last 7 days | ≤ 28 |
| `12h` | 12 hours | last 14 days | ≤ 28 |
| `1d` | 1 day | last 30 days | ≤ 30 |
| `1w` | 1 week | last 90 days | ≤ 13 |
| `1mo` | 30 days (fixed-width, not a calendar month) | last 365 days | ≤ 12 |

Every resolution is additionally hard-capped at 500 points server-side
(bucketing happens in SQL, not client-side), so the response size never grows
with how much history has accumulated — a chart backed by a year of data
looks the same size on the wire as one backed by a day.

### Example: a small dashboard chart

```typescript
const useMetricHistory = (metric: string, resolution: string) => {
  const [points, setPoints] = useState([]);
  const fetchWithAuth = useFetchWithAuth();

  useEffect(() => {
    const load = async () => {
      const resp = await fetchWithAuth(
        `/metrics/history?metric=${metric}&resolution=${resolution}`,
      );
      if (resp.ok) {
        const body = await resp.json();
        setPoints(body.points);
      }
    };
    load();
    const interval = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [metric, resolution]);

  return points;
};

// Usage: chart order throughput over the last day, hourly buckets
const points = useMetricHistory('orders_terminal', '1d');
// points[i] = { bucketStart, count, sum, avg, min, max }
```

---

## Example Implementation (React)

### 1. Auth Module (Context + Hook)

```typescript
// AuthContext.tsx
import { createContext, useState, useCallback, ReactNode } from 'react';

interface AuthContextType {
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<boolean>;  // Returns true if successful
  logout: () => void;
  currentUser: { userId: string; role: string } | null;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const register = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!resp.ok) {
        const { message } = await resp.json();
        throw new Error(Array.isArray(message) ? message[0] : message);
      }
      // Registration successful; now prompt login
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!resp.ok) {
        const { message } = await resp.json();
        throw new Error(message || 'Login failed');
      }
      const { accessToken } = await resp.json();
      setAccessToken(accessToken);

      // Fetch current user
      const meResp = await fetch('/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      if (meResp.ok) {
        setCurrentUser(await meResp.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!resp.ok) return false;

      const { accessToken } = await resp.json();
      setAccessToken(accessToken);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setAccessToken(null);
    setCurrentUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ accessToken, isLoading, error, register, login, refresh, logout, currentUser }}>
      {children}
    </AuthContext.Provider>
  );
};

// useAuth.ts
import { useContext } from 'react';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

### 2. Fetch Wrapper (With Auto-Refresh)

```typescript
// useFetchWithAuth.ts
import { useAuth } from './useAuth';
import { useCallback } from 'react';

export const useFetchWithAuth = () => {
  const { accessToken, refresh, logout } = useAuth();

  const fetchWithAuth = useCallback(
    async (url: string, options?: RequestInit) => {
      let resp = await fetch(url, {
        ...options,
        headers: {
          ...options?.headers,
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
      });

      // If 401, try to refresh
      if (resp.status === 401) {
        const refreshed = await refresh();
        if (!refreshed) {
          logout();
          throw new Error('Session expired, please login again');
        }

        // Retry with new token
        resp = await fetch(url, {
          ...options,
          headers: {
            ...options?.headers,
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
        });
      }

      return resp;
    },
    [accessToken, refresh, logout],
  );

  return fetchWithAuth;
};
```

### 3. Order Creation & Polling

```typescript
// useOrderCreation.ts
import { useState, useCallback } from 'react';
import { useFetchWithAuth } from './useFetchWithAuth';

interface Order {
  id: string;
  userId: string;
  status: 'PENDING' | 'RESERVED' | 'PAID' | 'COMPLETED' | 'FAILED';
  paymentInitiatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const isTerminal = (status: string) => ['COMPLETED', 'FAILED'].includes(status);
// Polling stops here too — RESERVED means "waiting for the user", not the server.
const isAwaitingAction = (status: string) => status === 'RESERVED' || isTerminal(status);

export const useOrderCreation = () => {
  const [order, setOrder] = useState<Order | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchWithAuth = useFetchWithAuth();

  /** Polls GET /orders/:id with backoff until `stopWhen(status)` is true. */
  const pollUntil = useCallback(
    async (start: Order, stopWhen: (status: string) => boolean) => {
      let current = start;
      let backoffMs = 1000;
      const maxBackoff = 16000;

      while (!stopWhen(current.status)) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));

        const pollResp = await fetchWithAuth(`/orders/${current.id}`);
        if (!pollResp.ok) {
          throw new Error('Failed to fetch order status');
        }

        const updated = (await pollResp.json()) as Order;
        if (updated.status !== current.status) {
          // Status changed, reset backoff
          current = updated;
          backoffMs = 1000;
        } else {
          // Status unchanged, back off
          backoffMs = Math.min(backoffMs * 2, maxBackoff);
        }

        setOrder(current);
      }
    },
    [fetchWithAuth],
  );

  const createAndPollOrder = useCallback(async () => {
    setError(null);
    try {
      // 1. Create order
      const createResp = await fetchWithAuth('/orders', { method: 'POST' });
      if (!createResp.ok) throw new Error('Failed to create order');

      const created = (await createResp.json()) as Order;
      setOrder(created);
      setIsPolling(true);

      // 2. Poll until RESERVED (show "Pay") or a terminal state.
      await pollUntil(created, isAwaitingAction);
      setIsPolling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsPolling(false);
    }
  }, [fetchWithAuth, pollUntil]);

  // 3. Confirm payment (the "Pay" button), then resume polling to the terminal state.
  const payForOrder = useCallback(async () => {
    if (!order) return;
    setError(null);
    try {
      const payResp = await fetchWithAuth(`/orders/${order.id}/pay`, {
        method: 'POST',
      });
      if (payResp.status === 409) {
        // Already paid / no longer RESERVED — just resume polling.
      } else if (!payResp.ok) {
        throw new Error('Failed to confirm payment');
      } else {
        setOrder((await payResp.json()) as Order);
      }

      setIsPolling(true);
      await pollUntil(order, isTerminal);
      setIsPolling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsPolling(false);
    }
  }, [order, fetchWithAuth, pollUntil]);

  return { order, isPolling, error, createAndPollOrder, payForOrder };
};
```

### 4. Order Page Component

```typescript
// OrderPage.tsx
import { useOrderCreation } from './useOrderCreation';

export const OrderPage = () => {
  const { order, isPolling, error, createAndPollOrder, payForOrder } = useOrderCreation();

  return (
    <div className="order-page">
      <h1>Create an Order</h1>

      {!order ? (
        <button onClick={createAndPollOrder} disabled={isPolling}>
          Create Order
        </button>
      ) : (
        <div className="order-status">
          <h2>Order #{order.id.slice(0, 8)}</h2>
          <div className={`status ${order.status.toLowerCase()}`}>
            {order.status}
          </div>

          {isPolling && (
            <div className="progress">
              <div className="spinner"></div>
              <p>Processing...</p>
              <ul className="steps">
                <li className={order.status !== 'PENDING' ? 'done' : 'pending'}>
                  Reserve inventory
                </li>
                <li className={['PAID', 'COMPLETED'].includes(order.status) ? 'done' : 'pending'}>
                  Process payment
                </li>
                <li className={order.status === 'COMPLETED' ? 'done' : 'pending'}>
                  Complete order
                </li>
              </ul>
            </div>
          )}

          {/* RESERVED + not polling = waiting on the user, not the server. */}
          {!isPolling && order.status === 'RESERVED' && !order.paymentInitiatedAt && (
            <div className="ready-to-pay">
              <p>✓ Inventory reserved — ready to pay.</p>
              <button onClick={payForOrder}>Pay</button>
            </div>
          )}

          {!isPolling && order.status === 'COMPLETED' && (
            <div className="success">
              ✓ Order completed successfully!
            </div>
          )}

          {!isPolling && order.status === 'FAILED' && (
            <div className="error">
              ✗ Order failed. Please try again.
            </div>
          )}

          <p className="timestamp">Created: {new Date(order.createdAt).toLocaleString()}</p>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
    </div>
  );
};
```

### 5. Admin User List Component

```typescript
// AdminUsersPanel.tsx
import { useEffect, useState } from 'react';
import { useFetchWithAuth } from './useFetchWithAuth';

interface User {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
  disabled: boolean;
  createdAt: string;
}

export const AdminUsersPanel = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchWithAuth = useFetchWithAuth();

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const resp = await fetchWithAuth('/admin/users');
        if (!resp.ok) throw new Error('Failed to fetch users');
        setUsers(await resp.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [fetchWithAuth]);

  const toggleDisable = async (userId: string, currentDisabled: boolean) => {
    const action = currentDisabled ? 'enable' : 'disable';
    const resp = await fetchWithAuth(`/admin/users/${userId}/${action}`, {
      method: 'PATCH',
    });
    if (resp.ok) {
      const updated = await resp.json();
      setUsers(users.map((u) => (u.id === userId ? updated : u)));
    }
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div className="admin-panel">
      <h2>Users</h2>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Disabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.disabled ? '✓' : '−'}</td>
              <td>
                <button
                  onClick={() => toggleDisable(user.id, user.disabled)}
                  className={user.disabled ? 'enable-btn' : 'disable-btn'}
                >
                  {user.disabled ? 'Enable' : 'Disable'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

---

## Demo Scenarios

### Scenario 1: Happy Path Order

**What to show:**
1. User registers and logs in
2. Creates an order (shows PENDING immediately)
3. Polling animation: "Checking inventory..." for ~1 second
4. Order reaches RESERVED — polling stops, a "Pay" button appears
5. User clicks "Pay" → `POST /orders/{id}/pay`, polling resumes
6. Order progresses: RESERVED → PAID → COMPLETED (takes ~2 seconds)
7. Success screen with order ID

**Backend timeline:**
```
t+0s:    POST /orders          → status=PENDING
t+~1s:   Inventory reserve     → status=RESERVED   (⏸ pauses here — no background process advances it)
...      (waits indefinitely for the user)
t+Ns:    POST /orders/:id/pay  → status=RESERVED, paymentInitiatedAt set (resumes fulfilment)
t+N+~1s: Payment auth          → status=PAID
t+N+~2s: Fulfillment           → status=COMPLETED
```

**UI talking points:**
- "Async fulfilment, with one deliberate manual gate: the order reserves automatically, but nothing charges until the user clicks Pay"
- "The pause is real, not simulated in the UI — the backend genuinely does nothing to a RESERVED order until /pay is called"
- "The pay endpoint is idempotent — a double-click can't double-charge (atomic claim in Postgres)"
- "Polling pattern keeps the UI responsive without WebSockets"
- "Correlation IDs (if shown) link this request through logs and traces"

---

### Scenario 2: Order Failure (Payment Declined)

**What to show:**
1. User creates an order
2. Order reaches RESERVED state (inventory succeeds) — "Pay" button appears
3. User clicks "Pay"
4. Payment is declined during the async authorization that follows
5. Order transitions to FAILED state
6. UI shows error screen, user can retry with a new order

**Triggered by:**
Override the `PaymentGateway.charge()` method in the test to return `{ authorized: false, declineReason: 'insufficient_funds' }`. Or patch a running instance via the test suite.

**UI talking points:**
- "Idempotency ensures safe retries—the same order ID won't charge twice"
- "Partial failure is handled gracefully—inventory is reserved but the order can be retried"
- "Even after a decline, `paymentInitiatedAt` stays set — the order can't be paid again, only recreated"

---

### Scenario 3: Session Expiry & Token Refresh

**What to show:**
1. User logs in and gets a token (15 min lifetime)
2. Wait or mock token expiry
3. User attempts an action (POST /orders or GET /orders)
4. API returns 401
5. UI automatically calls `/auth/refresh` (cookie rides along)
6. New token received, original request retried
7. User never sees the refresh—it happens silently

**To test:**
- Manually set a short `JWT_ACCESS_EXPIRES_IN` (e.g., `1s`)
- Log in, wait 2 seconds, try an action
- Watch the 401 → refresh → retry flow in the browser's Network tab

**UI talking points:**
- "The refresh token is httpOnly—impossible to steal via XSS"
- "Rotation on refresh means token reuse is detected, blocking account takeover"
- "Users never experience a jarring redirect; the app handles refresh silently"

---

### Scenario 4: Admin Panel — Disable a User

**What to show:**
1. Admin logs in and navigates to the User Management panel
2. Lists all users (GET /admin/users)
3. Clicks "Disable" next to a non-admin user
4. PATCH /admin/users/:id/disable succeeds
5. User's `disabled` flag turns on; user is shown as disabled in the UI
6. If that user tries to log in, they get a 401 (account disabled)
7. Admin can re-enable them (PATCH /admin/users/:id/enable)

**UI talking points:**
- "Role-based access control: only ADMINs see this panel (403 for non-admins)"
- "Disabling is immediate—existing tokens stay valid until expiry, but login is blocked"

---

### Scenario 5: Observability — Trace a Request

**What to show (if OTEL is configured):**
1. Note the `X-Correlation-ID` header from a request (or send a custom one)
2. Create an order with that ID in the header
3. Open Jaeger (`http://localhost:16686`)
4. Query by trace ID (correlated from the header)
5. Drill into the trace and show:
   - The initial POST /orders (client)
   - The OrdersService.createOrder span
   - The async background spans: InventoryConsumer → PaymentConsumer → CompletionConsumer
   - How the order status is updated at each step

**UI talking points:**
- "OpenTelemetry tracing shows the entire request journey—from client to DB to async consumers"
- "Correlation IDs let us link frontend errors to backend logs and traces"
- "Spans show latency at each layer—inventory reserve took 1.2s, payment took 0.8s, etc."

---

### Scenario 6: Pagination & List Performance

**What to show:**
1. User creates multiple orders
2. Lists their orders (GET /orders) — returns newest first
3. Shows pagination (if 100+ orders, paginate via query params or fetch more)
4. Order cache: note that recent order data is served from Redis, improving response time

**UI talking points:**
- "Orders are cached in Redis; list responses are fast even with many orders"
- "Pagination keeps the UI responsive on high-volume accounts"

---

### Scenario 7: Error Handling — Validation & Duplicate Email

**What to show:**
1. Try to register with a weak password (e.g., `abc`)
   - GET a 400 with `message: ["password must be at least 8 characters", ...]`
   - UI shows field errors to the user
2. Try to register with an email that's already taken
   - GET a 409 Conflict
   - UI shows "This email is already registered. Try logging in instead."
3. Try to create an order without authentication
   - GET a 401 (missing Bearer token)
   - UI redirects to login

**UI talking points:**
- "Validation errors are detailed—each field error is a separate message"
- "Conflict detection prevents duplicate registrations"
- "Proper HTTP status codes make error handling predictable and robust"

---

## Quick Start for UI Developers

1. **Environment Setup:**
   ```bash
   # Backend: Start the dev server
   cd order-lifecycle-backend
   cp .env.example .env
   docker compose up -d
   pnpm install
   pnpm start:dev
   # API at http://localhost:3000, Swagger at /docs

   # Frontend: Create a new React app
   npx create-react-app order-ui
   cd order-ui
   npm install axios react-router-dom
   ```

2. **Test Auth:**
   ```bash
   # Register
   curl -X POST http://localhost:3000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"P@ssw0rd123!"}'

   # Login
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"P@ssw0rd123!"}' \
     -c cookies.txt

   # Get token from response, use in Authorization header
   curl http://localhost:3000/auth/me \
     -H "Authorization: Bearer <token>" \
     -b cookies.txt
   ```

3. **Test Order Flow:**
   ```bash
   # Create order
   curl -X POST http://localhost:3000/orders \
     -H "Authorization: Bearer <token>" \
     -b cookies.txt

   # Poll for status (in a loop) — stops advancing once RESERVED
   curl http://localhost:3000/orders/<id> \
     -H "Authorization: Bearer <token>" \
     -b cookies.txt

   # Confirm payment once RESERVED (the simulated "Pay" click) — required to
   # progress any further; nothing does this automatically
   curl -X POST http://localhost:3000/orders/<id>/pay \
     -H "Authorization: Bearer <token>" \
     -b cookies.txt

   # Poll again to watch RESERVED -> PAID -> COMPLETED
   curl http://localhost:3000/orders/<id> \
     -H "Authorization: Bearer <token>" \
     -b cookies.txt
   ```

4. **Integrate into React:**
   - Copy the React hooks from the Example Implementation section
   - Build pages for Auth (Register/Login), Orders (Create/List), Admin (User Management)
   - Wire up polling logic with the order creation component
   - Test session refresh by setting a short token lifetime

5. **Deploy Both Together:**
   - See [INTEGRATION.md](INTEGRATION.md) for Render/Fly/Railway deployment
   - UI can be a separate Next.js/React app on a different domain (requires CORS_ORIGIN + COOKIE_SAMESITE=none)

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| CORS errors on cross-origin requests | CORS_ORIGIN not set | Set `CORS_ORIGIN=https://your-ui-domain.com` in backend env |
| Refresh cookie not sent on subsequent requests | `credentials: 'include'` missing | Add `credentials: 'include'` to all fetch calls |
| Order status never advances past PENDING | RabbitMQ connection issue | Check `RABBITMQ_URL` env var; ensure CloudAMQP/RabbitMQ is running |
| Order stuck in RESERVED forever | This is expected — RESERVED no longer auto-advances. Call `POST /orders/:id/pay` | Not a bug; wire up the "Pay" button (see [Confirming Payment](#confirming-payment-the-pay-button)) |
| `POST /orders/:id/pay` returns 409 | Order isn't RESERVED, or payment was already initiated for it | Treat as a no-op: disable the button and resume polling — it's not an error to surface to the user |
| `/metrics/history` returns an empty `points` array | No samples recorded yet in the requested window, or that metric hasn't fired | Trigger the relevant activity (e.g. create+pay an order for `orders_terminal`) and retry; widen `from`/`to` |
| Token refresh fails even though token expired | Refresh cookie is missing or httpOnly misconfiguration | Check browser DevTools Cookies; ensure the cookie was set with `HttpOnly` flag |
| Admin endpoints return 403 even with admin user | Role not propagated in JWT | Check `auth.service.ts` that `role` is included in the JWT payload |
| Observability traces are missing | OTEL not configured | Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable tracing; unset disables tracing |

---

## Next Steps

1. **Build the UI**: Use the React hooks and patterns above to create a full-featured dashboard.
2. **Add Charts**: Use Recharts or Chart.js to visualize `GET /metrics/history` (throughput, status distribution, latency) — it's already resolution-bucketed and durable, so no client-side aggregation is needed.
3. **Integrate Observability**: Link correlation IDs from the UI to Jaeger traces and Prometheus dashboards.
4. **Deploy**: Push to Render/Vercel and set up cross-origin CORS.
5. **Load Testing**: Use k6 or Artillery to simulate 100+ concurrent orders and measure throughput; tune RabbitMQ consumer counts.
6. **Custom Payment Logic**: Replace the simulated `PaymentGateway.charge()` with real payment provider integration (Stripe, etc.).

---

## References

- **API Reference**: Run the backend and open `http://localhost:3000/docs` (Swagger UI)
- **Deployment**: See [INTEGRATION.md](INTEGRATION.md)
- **Observability**: See [`ops/observability.md`](ops/observability.md)
- **Auth Details**: See [INTEGRATION.md § 1](INTEGRATION.md#1-authentication-model-read-this-first)
