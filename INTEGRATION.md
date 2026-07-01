# Order Lifecycle API — Integration & Deployment Guide

A practical guide for wiring a UI to this backend and getting it deployed. For
the interactive API reference, run the app and open **`/docs`** (Swagger). For
metrics/tracing queries see [`ops/observability.md`](ops/observability.md).

- **Stack:** NestJS 11 · PostgreSQL (TypeORM) · RabbitMQ (event-driven
  fulfilment) · Redis (read cache) · JWT auth · Prometheus metrics · OpenTelemetry tracing.
- **Base URL:** no global route prefix — endpoints live at the root (`/auth/...`,
  `/orders/...`). Swagger UI at `/docs`, Prometheus at `/metrics`, health at `/health`.

---

## 1. Authentication model (read this first)

Auth is split across two tokens on purpose:

| Token | Where it lives | Lifetime | Sent how |
| --- | --- | --- | --- |
| **Access token** (JWT) | returned in the JSON body; the UI keeps it **in memory** | short (`15m` default) | `Authorization: Bearer <token>` |
| **Refresh token** | an **httpOnly cookie** the browser stores automatically (`refresh_token`, `Path=/auth/refresh`) | long (`7d` default), **rotated** on every use | sent automatically by the browser to `/auth/refresh` |

Why: keeping the access token in memory (not `localStorage`) limits XSS blast
radius, and the refresh token being httpOnly means page JavaScript can never
read it. Every refresh **rotates** the token and reuse of a rotated token
revokes the whole family (theft detection).

> **Cross-origin caveat (important for a portfolio UI):** the refresh cookie is
> currently `SameSite=Strict` and CORS is **not** enabled. That is fine when the
> UI and API share an origin (same domain, or a same-domain reverse proxy). If
> the UI is on a **different** domain than the API you must change two things —
> see [§5 Deployment](#5-deployment-setup).

---

## 2. API reference

### Auth — `/auth`

| Method | Path | Auth | Body | Success | Notes |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | public | `{ email, password }` | `201` `UserResponseDTO` | Strong password required (≥8, upper/lower/number/symbol, ≤72 bytes). `409` if email taken. |
| POST | `/auth/login` | public | `{ email, password }` | `200` `{ accessToken }` + sets `refresh_token` cookie | `401` generic on bad creds (no user enumeration). |
| POST | `/auth/refresh` | refresh cookie | — | `200` `{ accessToken }` + new cookie | `401` if cookie missing/invalid/reused. |
| GET | `/auth/me` | Bearer | — | `200` `{ userId, role }` | Any authenticated user. |

### Products & Cart — `/products`, `/cart` (all require `Authorization: Bearer`)

| Method | Path | Body | Success | Notes |
| --- | --- | --- | --- | --- |
| GET | `/products` | — | `200` `ProductResponseDTO[]` | The catalog, alphabetical. Seeded on boot; `stock` is live. |
| GET | `/cart` | — | `200` `CartResponseDTO` | The caller's open cart; created lazily if none exists. |
| POST | `/cart/items` | `{ productId, quantity }` | `200` `CartResponseDTO` | Upsert — **sets** the quantity, doesn't add to it. `404` if product doesn't exist. |
| DELETE | `/cart/items/:productId` | — | `200` `CartResponseDTO` | Removes the line item. |
| POST | `/cart/checkout` | **none** | `201` `OrderResponseDTO` (status `PENDING`) | The **only** way to create an order — see §3. `409` if empty or already checked out. |

### Orders — `/orders` (all require `Authorization: Bearer`)

| Method | Path | Body | Success | Notes |
| --- | --- | --- | --- | --- |
| GET | `/orders` | — | `200` `OrderResponseDTO[]` | The caller's own orders, newest first. |
| GET | `/orders/:id` | — | `200` `OrderResponseDTO` | Owner-scoped; another user's order returns `404`. |
| POST | `/orders/:id/pay` | **none** | `200` `OrderResponseDTO` | Confirms payment on a RESERVED order (simulated "Pay"). `409` if not RESERVED or already initiated. |
| POST | `/orders/:id/cancel` | **none** | `200` `OrderResponseDTO` | Cancels a PENDING order, or RESERVED before payment is confirmed. Restores any reserved stock. `409` otherwise. |

### Admin — `/admin/users` (require Bearer **and** `ADMIN` role, else `403`)

| Method | Path | Success | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users` | `200` `UserResponseDTO[]` | Metadata only, never passwords. |
| PATCH | `/admin/users/:id/disable` | `200` `UserResponseDTO` | A disabled user cannot log in or refresh. |
| PATCH | `/admin/users/:id/enable` | `200` `UserResponseDTO` | Re-enables. |

### Ops

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness. |
| GET | `/metrics` | Prometheus exposition (scrape target). |

### Payloads

```jsonc
// UserResponseDTO
{ "id": "uuid", "email": "user@example.com", "role": "USER", "disabled": false, "createdAt": "2026-07-01T..." }

// ProductResponseDTO
{ "id": "uuid", "name": "Standard Widget", "sku": "WIDGET-001", "stock": 75 }

// CartResponseDTO
{ "id": "uuid", "items": [{ "productId": "uuid", "productName": "Standard Widget", "productStock": 75, "quantity": 2 }], "createdAt": "...", "updatedAt": "..." }

// OrderResponseDTO
{ "id": "uuid", "userId": "uuid", "status": "PENDING", "paymentInitiatedAt": null, "items": [{ "productId": "uuid", "productName": "Standard Widget", "quantity": 2 }], "createdAt": "...", "updatedAt": "..." }
```

Order `status` moves through the state machine:
`PENDING → RESERVED → PAID → COMPLETED`, or `PENDING/RESERVED → FAILED`
(insufficient stock or payment decline), or `PENDING/RESERVED → CANCELLED`
(caller-initiated, only before payment is confirmed).
`RESERVED` is a genuine pause, not a transient state — nothing advances the
order further until the caller calls `POST /orders/{id}/pay` (see below), or
cancels it. `paymentInitiatedAt` is null until `/pay` succeeds, and blocks
cancellation once set.

---

## 3. How the UI should use these endpoints

**Login / session bootstrap**

1. `POST /auth/login` → store `accessToken` in a memory variable (React state,
   a module singleton — **not** `localStorage`). The browser stores the refresh
   cookie for you.
2. Send `Authorization: Bearer <accessToken>` on every protected call.
3. On a `401`, call `POST /auth/refresh` (no body — the cookie rides along),
   store the new `accessToken`, and retry the original request once. If refresh
   also `401`s, send the user back to login. A shared "refresh-in-flight"
   promise avoids stampeding refreshes from parallel requests.
4. Browser fetches must use **`credentials: 'include'`** so the refresh cookie
   is sent/stored. (`fetch(url, { credentials: 'include' })` /
   `axios: { withCredentials: true }`.)

**Building a cart, then placing and tracking an order (fulfilment is asynchronous, with one manual gate!)**

There is no bodyless `POST /orders` — an order always comes from a cart:

```
GET  /products                              -> browse the catalog
POST /cart/items    { productId, quantity } -> add/set a line item (upsert)
POST /cart/checkout                         -> creates the order (once only)
```

`POST /cart/checkout` atomically claims the cart (a repeat call, or a
concurrent double-click, gets `409`) and returns immediately with
`status: "PENDING"`. Inventory reservation happens over RabbitMQ — a real,
atomic per-product stock decrement, not a simulation — and lands the order in
`RESERVED`, or `FAILED` (reason `insufficient_stock`) if a line item was
short. Once `RESERVED`, the order **stops**. Nothing pays, completes, or
fails it until the UI calls `POST /orders/{id}/pay` (the simulated "Pay"
button) — or the caller cancels it with `POST /orders/{id}/cancel`, which
restores any reserved stock. Only after `/pay` does payment authorization →
completion resume asynchronously. The UI must **poll** `GET /orders/:id`
(e.g. every ~1s for a few seconds), stop polling once it sees `RESERVED`
(show the Pay/Cancel buttons), call pay or cancel on click, then resume
polling until a terminal state (`COMPLETED`, `FAILED`, or `CANCELLED`).
There is no push/websocket channel — poll, or optimistically show a
"processing" state and refresh.

```
POST /cart/items {productId,qty}   -> { items: [...] }
POST /cart/checkout                -> { id, status: "PENDING" }
GET  /orders/{id}      (t+1)       -> { status: "RESERVED" }        // pauses here — poll stops, show "Pay"/"Cancel"
POST /orders/{id}/pay  (t+N)       -> { status: "RESERVED", paymentInitiatedAt: "..." }  // resumes fulfilment
GET  /orders/{id}    (t+N+1)       -> { status: "PAID" }
GET  /orders/{id}    (t+N+2)       -> { status: "COMPLETED" }   // terminal
```

The pay, cancel, and checkout endpoints are all idempotent (atomic claims in
Postgres): a double-click on any of them gets a `409` on the loser, not a
duplicate charge, cancellation, or order. Treat `409` there as "nothing to
do," not an error to surface.

**Correlation IDs (nice-to-have for debugging):** send an `x-correlation-id`
header and it is echoed on the response and stamped across every log/trace for
that request and its downstream consumers. Omit it and the server generates one
(also returned on the response header) — surface it in your error UI so a user
can quote it in a bug report.

**Errors:** standard Nest error envelope — `{ statusCode, message, error }`.
Handle `401` (refresh/login), `403` (not admin), `404` (not found / not yours),
`409` (duplicate email), `400` (validation — `message` is an array of strings).

---

## 4. Running locally

```bash
cp .env.example .env            # then edit secrets
docker compose up -d            # postgres + rabbitmq + redis
pnpm install
pnpm start:dev                  # http://localhost:3000, docs at /docs
# An admin user and a demo product catalog are seeded automatically on every
# boot (idempotent — safe across restarts). ADMIN_EMAIL/ADMIN_PASSWORD
# control the admin's credentials; defaults match .env.example.
# pnpm admin:create is still available if you want a *second* admin.
```

Add the observability stack (Prometheus :9090, Grafana :3001, Jaeger :16686):

```bash
docker compose --profile observability up -d
```

---

## 5. Deployment setup

**Environment variables** (see `.env.example` for the full list):

| Var | Required | Notes |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | ✅ | Managed Postgres. |
| `DB_SSL` | ⬜ | `true` for managed Postgres that requires TLS (Neon, Supabase). Render's internal DB: leave `false`. |
| `RABBITMQ_URL` | ✅ | e.g. `amqps://user:pass@host/vhost` (CloudAMQP). |
| `REDIS_URL` | ✅ | e.g. `redis://:pass@host:6379` (or `rediss://...`). |
| `JWT_ACCESS_SECRET` | ✅ | **Long random secret** — never the dev default. |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN_DAYS` | ⬜ | Defaults `15m` / `7`. |
| `CACHE_TTL_SECONDS` | ⬜ | Cache safety-net TTL (default 60). |
| `CORS_ORIGIN` | ⬜* | Comma-separated UI origins; exact (`https://demo.oliverhatherton.com`) or a `*.` subdomain wildcard (`https://*.oliverhatherton.com`). Unset = CORS off (same-origin only). *Required if the UI is on another origin.* |
| `COOKIE_SAMESITE` | ⬜* | `none` to send the refresh cookie cross-site (needs HTTPS), else `strict`. *Set `none` for a cross-origin UI.* |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | ⬜ | Set the endpoint to ship traces; unset in production disables tracing (no console spam). |
| `NODE_ENV=production` | ✅ | Enables `secure` cookies and the production defaults. |
| `PORT` | ⬜ | The host provides it; the app binds `0.0.0.0:$PORT` (default 3000). |

**Cross-origin UI (UI domain ≠ API domain)** — no code changes, just two env
vars: set `CORS_ORIGIN` and `COOKIE_SAMESITE=none` (HTTPS required, which
production is). `CORS_ORIGIN` takes exact origins
(`https://order-lifecycle-demo.oliverhatherton.com`) and/or a `*.` subdomain
wildcard (`https://*.oliverhatherton.com`) — the wildcard matches any subdomain
but not the apex, and is anchored so it can't match a look-alike
(`eviloliverhatherton.com`) or suffix trick (`…oliverhatherton.com.evil.com`).
Prefer an exact origin for a single known subdomain. Leave both unset / `strict`
when the UI and API share an origin. The UI must send requests with credentials
(`fetch(..., { credentials: 'include' })`).

**Database schema — TypeORM migrations.** Dev auto-syncs from the entities;
**production never does** — it runs versioned migrations
(`src/database/migrations`) automatically on boot (`migrationsRun`), and
`synchronize` is off. So a production deploy creates/updates its schema by
applying pending migrations, with no manual step. Workflow:

```bash
# after changing entities, generate a migration against a dev DB:
pnpm migration:generate          # writes src/database/migrations/<ts>-Migration.ts
#   then add the new class to src/database/migrations/index.ts (webpack needs the
#   explicit import; the CLI reads the same array)
pnpm migration:run               # apply locally
pnpm migration:revert            # roll back the last one
pnpm migration:show              # list applied/pending
```

The CLI uses `src/database/data-source.ts` (reads the same `DB_*` env via
dotenv). The running app applies the same list on boot in production.

**Build & run.** A multi-stage [`Dockerfile`](Dockerfile) builds the app and
ships a slim prod image (`node dist/main`); [`.dockerignore`](.dockerignore)
keeps the context lean. Locally: `docker build -t olb . && docker run -p 3000:3000 --env-file .env olb`.

**Admin user & product catalog:** seeded automatically on every boot,
including the deployed instance — set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in the
deployment's env (falls back to the same demo defaults as `.env.example` if
unset). `pnpm admin:create` is only needed for an *additional* admin.

---

## 6. Deploying to Render (free)

The app needs **three backing services**: Postgres and Redis have free Render
tiers, but **RabbitMQ does not exist on Render** — use CloudAMQP's free plan for
that one. The repo ships a [`render.yaml`](render.yaml) Blueprint that wires up
the web service + Postgres + Key Value (Redis) for you.

**Prerequisites**
1. Create a **CloudAMQP** account → new instance → **"Little Lemur" (free)** →
   copy its `amqps://…` URL.

**Option A — Blueprint (recommended)**
1. Push this repo to GitHub.
2. Render Dashboard → **New → Blueprint** → pick the repo. It reads
   `render.yaml` and provisions the web service, Postgres and Key Value, wiring
   `DB_*` and `REDIS_URL` automatically and generating `JWT_ACCESS_SECRET`.
3. When prompted, fill the `sync:false` vars: **`RABBITMQ_URL`** (the CloudAMQP
   URL), **`CORS_ORIGIN`** (your UI origin), **`COOKIE_SAMESITE`** (`none` for a
   cross-origin UI).
4. Deploy. On boot the app runs its TypeORM migrations automatically, creating
   the schema — no schema step to configure.
5. Verify: `GET https://<your-app>.onrender.com/health`, then `/docs`.

**Option B — manual dashboard**
1. **New → PostgreSQL** (free) and **New → Key Value** (free); note their
   connection details.
2. **New → Web Service** → this repo → **Runtime: Docker** →
   **Health Check Path: `/health`**.
3. Add env vars: `NODE_ENV=production`, `DB_SSL=false`, the five `DB_*` from the
   Postgres, `REDIS_URL` from Key Value, `RABBITMQ_URL` (CloudAMQP), a strong
   `JWT_ACCESS_SECRET`, and — for a cross-origin UI — `CORS_ORIGIN` +
   `COOKIE_SAMESITE=none`. Migrations run on boot; there's no schema step.

> **Free-tier caveats:** Render's free web service **sleeps after ~15 min idle**
> (cold start on the next request — but the app also needs RabbitMQ/Redis
> reachable at boot, so cold starts take a few seconds). Render's **free
> Postgres expires after ~30 days** — fine for a demo, but expect to recreate
> it. Because the service sleeps, the async fulfilment chain still runs while
> awake; a request that arrives during cold start just waits for boot.

### Other free hosts

- **Fly.io** — runs the same Docker image; more control, a bit more config
  (`fly.toml`). Pair with Fly Postgres + Upstash Redis + CloudAMQP.
- **Koyeb** — one free instance, Docker or Git deploy.
- **Railway** — smoothest DX and can host the app + Postgres + Redis together
  (only CloudAMQP is external), but its free usage is trial credit, not an
  always-free tier.

**Managed free backing services** (mix and match): Postgres → **Neon** (set
`DB_SSL=true`) or Supabase; Redis → **Upstash** (`rediss://` URL); RabbitMQ →
**CloudAMQP** (the only realistic free option; `amqps://`).
