# Observability — querying the metrics (Epic 5)

The app exposes Prometheus metrics at `GET /metrics`. Bring up the opt-in stack
with `docker compose --profile observability up` (Prometheus on :9090, Grafana
on :3001) and run these in the Prometheus expression browser or a Grafana panel.

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
