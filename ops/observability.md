# Observability — querying the metrics (Epic 5)

The app exposes Prometheus metrics at `GET /metrics`. Bring up the opt-in stack
with `docker compose --profile observability up` (Prometheus on :9090, Grafana
on :3001) and run these in the Prometheus expression browser or a Grafana panel.
Grafana comes up with the **Order Lifecycle** dashboard already provisioned
(`ops/grafana/dashboards/order-lifecycle.json`) — every query below has a panel
there.

## HTTP (5.1)

Request rate by route:

```promql
sum by (route) (rate(http_request_duration_seconds_count[5m]))
```

p95 latency by route:

```promql
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
```

Error rate (5xx share):

```promql
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))
  / sum(rate(http_request_duration_seconds_count[5m]))
```

## Cache

Hit rate overall, and by key class (`order`, `orders`):

```promql
sum(rate(cache_requests_total{result="hit"}[5m])) / sum(rate(cache_requests_total[5m]))
sum by (key_class) (rate(cache_requests_total{result="hit"}[5m]))
  / sum by (key_class) (rate(cache_requests_total[5m]))
```

A Redis error counts as a miss (the cache is fail-open). With
`CACHE_ENABLED=false` nothing is recorded at all.

## Retries & dead-letters

Failed handlers retry with exponential backoff (1s → 2s → 4s, via
`<queue>.retry.<delay>ms` wait queues), then dead-letter to
`order_lifecycle.dlq`:

```promql
sum by (consumer, outcome) (rate(consumer_messages_total{outcome=~"retried|failed"}[5m]))
```

## Consumers & DB (5.3)

**Spot a slow consumer** — p95 processing time per consumer:

```promql
histogram_quantile(0.95, sum by (le, consumer) (rate(consumer_processing_duration_seconds_bucket[5m])))
```

Consumer throughput / outcomes:

```promql
sum by (consumer, outcome) (rate(consumer_messages_total[5m]))
```

**Detect a failure spike** — order failures vs completions:

```promql
sum by (state) (rate(orders_terminal_total[5m]))
```

DB operation p95:

```promql
histogram_quantile(0.95, sum by (le, operation) (rate(db_query_duration_seconds_bucket[5m])))
```

## Tracing (5.4)

OpenTelemetry auto-instruments HTTP, `pg` and `amqplib`, so one trace follows a
request through the DB and across RabbitMQ to `COMPLETED`.

- **No setup:** with no `OTEL_EXPORTER_OTLP_ENDPOINT`, spans print to the console
  (`pnpm start:dev`) — handy to eyeball the span tree locally.
- **Jaeger UI:** `docker compose --profile observability up`, set
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, restart the app, then
  open <http://localhost:16686>, pick service `order-lifecycle-backend`, and a
  `POST /orders` shows one trace spanning the HTTP handler, the DB writes and
  each consumer hop. The consumer spans are children of the request because the
  amqplib instrumentation propagates W3C trace context on the message headers.
