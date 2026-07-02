# Order Lifecycle — Backend

An event-driven order-fulfilment API. Orders move through an async
`PENDING → RESERVED → PAID → COMPLETED` pipeline over RabbitMQ, backed by a
real product catalog, cart, JWT auth with rotating refresh tokens, and a full
observability stack — built solo, one epic at a time (see
[`INTEGRATION.md`](INTEGRATION.md) for the full history and design
rationale).

**Live:** [order-lifecycle.oliverhatherton.com](https://order-lifecycle.oliverhatherton.com) ·
**API docs:** [api.oliverhatherton.com/order-lifecycle/docs](https://api.oliverhatherton.com/order-lifecycle/docs) ·
**Frontend:** [order-lifecycle-frontend](https://github.com/oliverhatherton/order-lifecycle-frontend)

## What it does

A user registers, browses a seeded product catalog, builds a cart, and
checks out. Checkout is the only way to create an order — it's `PENDING`
until inventory is reserved (`RESERVED`), payment is confirmed via an
explicit `POST /orders/:id/pay` (`PAID`), and fulfilment completes
(`COMPLETED`). Each transition is driven by a RabbitMQ consumer, not a
direct API call, so the flow is genuinely asynchronous end to end.

Highlights:

- **JWT auth** — short-lived access tokens kept client-side in memory,
  long-lived refresh tokens as rotating `httpOnly` cookies with reuse/theft
  detection (a stolen, already-rotated token revokes the whole session
  family).
- **Idempotent payment authorization** — a redelivered event can't
  double-charge; the payment gateway call is keyed by order id.
- **Transactional outbox** — lifecycle events are written in the same DB
  transaction as the state change they announce, then relayed to RabbitMQ,
  so a broker hiccup can't silently drop an event.
- **Redis cache-aside** for hot reads, with hit-rate metrics.
- **Full observability** — Prometheus metrics (HTTP, consumers, DB queries),
  OpenTelemetry tracing across HTTP → DB → RabbitMQ, correlation IDs
  threaded through the whole chain, and Grafana dashboards.
- **Resilience** — bounded retries + a dead-letter queue per consumer, so a
  poison message can't wedge the pipeline.

## Stack

NestJS 11 · TypeScript · PostgreSQL (TypeORM, versioned migrations) ·
RabbitMQ (`@golevelup/nestjs-rabbitmq`) · Redis (`ioredis`) · Prometheus +
Grafana · OpenTelemetry · Docker · GitHub Actions CI.

## Running locally

Requires Docker (Postgres, RabbitMQ, Redis via `docker-compose.yml`):

```bash
pnpm install
docker compose up -d
pnpm start:dev
```

The API listens with no route prefix (`/auth/...`, `/orders/...`, ...).
Swagger UI is at `/docs`, Prometheus metrics at `/metrics`, health at
`/health`.

## Testing

```bash
pnpm test          # unit tests
pnpm test:e2e       # e2e — spins up real Postgres/RabbitMQ/Redis via Testcontainers
pnpm test:load      # autocannon load test against a running instance
```

90+ e2e tests and 30+ unit suites run automatically on every push via
[GitHub Actions](.github/workflows/ci.yml), alongside a push-only load-test
job.

## Docs

- [`INTEGRATION.md`](INTEGRATION.md) — API reference, how a UI should
  consume it, deployment/hosting setup.
- [`UI-INTEGRATION-GUIDE.md`](UI-INTEGRATION-GUIDE.md) — a deeper walkthrough
  for the frontend, written against the actual demo UI.
- [`ops/observability.md`](ops/observability.md) — PromQL for the metrics
  this service exposes.

## Deployment

Deployed on [Render](https://render.com) via [`render.yaml`](render.yaml)
(Docker + free Postgres + free Key Value/Redis); RabbitMQ is provisioned
separately via CloudAMQP since Render doesn't offer it. Schema changes ship
as TypeORM migrations, run automatically on boot.
