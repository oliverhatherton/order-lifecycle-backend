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

### Orders — `/orders` (all require `Authorization: Bearer`)

| Method | Path | Body | Success | Notes |
| --- | --- | --- | --- | --- |
| POST | `/orders` | **none** | `201` `OrderResponseDTO` (status `PENDING`) | Fulfilment then runs **asynchronously** (see §3). |
| GET | `/orders` | — | `200` `OrderResponseDTO[]` | The caller's own orders, newest first. |
| GET | `/orders/:id` | — | `200` `OrderResponseDTO` | Owner-scoped; another user's order returns `404`. |

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

// OrderResponseDTO
{ "id": "uuid", "userId": "uuid", "status": "PENDING", "createdAt": "...", "updatedAt": "..." }
```

Order `status` moves through the state machine:
`PENDING → RESERVED → PAID → COMPLETED`, or `PENDING/RESERVED → FAILED`.

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

**Placing and tracking an order (fulfilment is asynchronous!)**

`POST /orders` returns immediately with `status: "PENDING"`. Inventory →
payment → completion happen over RabbitMQ afterwards. The UI must **poll**
`GET /orders/:id` (e.g. every ~1s for a few seconds) and reflect the status as
it advances to `COMPLETED`, or show the failure if it lands on `FAILED`. There
is no push/websocket channel — poll, or optimistically show a "processing"
state and refresh.

```
POST /orders            -> { id, status: "PENDING" }
GET  /orders/{id}  (t+1) -> { status: "RESERVED" }
GET  /orders/{id}  (t+2) -> { status: "PAID" }
GET  /orders/{id}  (t+3) -> { status: "COMPLETED" }   // terminal
```

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
pnpm admin:create               # optional: seed an ADMIN (uses ADMIN_EMAIL/PASSWORD)
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
| `RABBITMQ_URL` | ✅ | e.g. `amqp://user:pass@host:5672` (or `amqps://...`). |
| `REDIS_URL` | ✅ | e.g. `redis://:pass@host:6379` (or `rediss://...`). |
| `JWT_ACCESS_SECRET` | ✅ | **Long random secret** — do not ship the dev default. |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN_DAYS` | ⬜ | Defaults `15m` / `7`. |
| `CACHE_TTL_SECONDS` | ⬜ | Cache safety-net TTL (default 60). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | ⬜ | Unset → spans print to console. |
| `NODE_ENV=production` | ✅ | Enables `secure` cookies; **disables TypeORM `synchronize`** (see below). |
| `PORT` | ⬜ | Host provides it; the app reads `PORT` (default 3000). |

**Two things you must change for a cross-origin browser UI** (UI domain ≠ API
domain). Both are one-liners; they aren't on by default because the app ships
same-origin-safe:

1. **Enable CORS with credentials** in `src/main.ts`:
   ```ts
   app.enableCors({ origin: 'https://your-ui.example', credentials: true });
   ```
2. **Relax the refresh cookie** so the browser sends it cross-site — in
   `src/modules/auth/auth.cookie.ts`, use `sameSite: 'none'` with `secure: true`
   in production (Strict blocks cross-site sends). Keep `Strict` only if UI and
   API are same-site. Both require **HTTPS** in production.

**Database schema — mind `synchronize`.** In production
(`NODE_ENV=production`) TypeORM auto-sync is **off** (`src/config/database.config.ts`),
and this repo ships **no migrations** yet, so tables won't be created
automatically. For a demo you can either (a) temporarily run with
`synchronize: true` for the first boot to create the schema, or (b) add TypeORM
migrations (`typeorm migration:generate`) and run them on deploy. Don't leave
`synchronize: true` on for a real workload.

**Build & run:** `pnpm build` → `node dist/main` (`pnpm start:prod`). Tracing
auto-starts (console exporter unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set).

**Admin user:** run `pnpm admin:create` once (with `ADMIN_EMAIL` /
`ADMIN_PASSWORD` set) against the deployed DB, or promote a row manually.

---

## 6. Free hosting options

This app needs **three backing services** (Postgres, RabbitMQ, Redis) plus the
Node process. The realistic free path is a free app host + managed free tiers:

**App (Node service)**
- **Render** — free web service; simplest Docker/Node deploy. Caveat: free
  instances **sleep after ~15 min idle** (cold starts) — fine for a portfolio.
- **Fly.io** — generous free allowance, runs your Docker image close to the DB;
  a bit more config (`fly.toml`).
- **Koyeb** — one free instance, Git-push deploy.
- **Railway** — smoothest DX and can host Postgres + Redis too, but free usage
  is trial credit rather than an always-free tier.

**Postgres (free tier)** — **Neon** (recommended, generous free, serverless),
Supabase, or Railway's Postgres.

**Redis (free tier)** — **Upstash** (recommended; free tier, `rediss://` URL).

**RabbitMQ (free tier)** — **CloudAMQP "Little Lemur"** (free shared plan;
gives you an `amqps://` URL for `RABBITMQ_URL`).

**A pragmatic combo for a portfolio demo:** Render (app) + Neon (Postgres) +
Upstash (Redis) + CloudAMQP (RabbitMQ). Set the four connection URLs/vars, a
strong `JWT_ACCESS_SECRET`, `NODE_ENV=production`, enable CORS + `SameSite=None`
for your UI origin, and create the schema on first boot. Expect a cold-start
delay on the first request after idle on free app tiers.

> If juggling three managed services is too much for a demo, **Railway** can run
> the app + Postgres + Redis together and you'd only need CloudAMQP externally —
> fewer dashboards, at the cost of trial-credit limits.
