window.BENCHMARK_DATA = {
  "lastUpdate": 1793136149002,
  "repoUrl": "https://github.com/oliverhatherton/order-lifecycle-backend",
  "entries": {
    "Load test — latency": [
      {
        "commit": {
          "author": {
            "email": "118294630+olivrrcode@users.noreply.github.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "committer": {
            "email": "118294630+olivrrcode@users.noreply.github.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "distinct": true,
          "id": "2cdf0173d1f3e9ccd428554fe38083169bd6ab3c",
          "message": "fix: set git identity before committing the gh-pages bootstrap\n\nThe runner has no default git user configured, so the orphan-branch\ncommit failed with \"empty ident name\".",
          "timestamp": "2026-07-03T01:14:08+01:00",
          "tree_id": "3ab7dae8ad85a4cda834ef5bd52c3e25ca759321",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/2cdf0173d1f3e9ccd428554fe38083169bd6ab3c"
        },
        "date": 1783037888886,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) p50",
            "value": 33,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p90",
            "value": 44,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p99",
            "value": 60,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p50",
            "value": 46,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p90",
            "value": 52,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p99",
            "value": 126,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside) p50",
            "value": 35,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside) p90",
            "value": 42,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside) p99",
            "value": 62,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "committer": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "distinct": true,
          "id": "1db173e2687b1721aaebc731d512698f85859b24",
          "message": "feat: replace autocannon load test with k6 and add cache on/off A/B\n\nops/load-test.k6.js seeds real completed orders through the full pipeline,\nthen load-tests /health, /products, /orders and /orders/:id, writing the same\nreport shape so the CI benchmark trends continue. pnpm load:cache-ab runs\nalternating cache-on/off rounds against fresh app processes and reports\nmedians. CI installs k6 via grafana/setup-k6-action. The compose Postgres\nhost port is now overridable (POSTGRES_HOST_PORT).",
          "timestamp": "2026-10-27T20:04:48Z",
          "tree_id": "f5879274467d7f9cee73d99e6b0091738c2576b3",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/1db173e2687b1721aaebc731d512698f85859b24"
        },
        "date": 1793131676369,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) p50",
            "value": 16.89,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p90",
            "value": 22.37,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p99",
            "value": 34.63,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p50",
            "value": 24.97,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p90",
            "value": 31.17,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p99",
            "value": 209.1,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p50",
            "value": 18.29,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p90",
            "value": 21.66,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p99",
            "value": 34.15,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p50",
            "value": 18.14,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p90",
            "value": 21.09,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p99",
            "value": 34.01,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "committer": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "distinct": true,
          "id": "17703fc7bca4a5397f37f3d1d9263dd673539a21",
          "message": "feat: replace autocannon load test with k6 and add cache on/off A/B\n\nops/load-test.k6.js seeds real completed orders through the full pipeline,\nthen load-tests /health, /products, /orders and /orders/:id, writing the same\nreport shape so the CI benchmark trends continue. pnpm load:cache-ab runs\nalternating cache-on/off rounds against fresh app processes and reports\nmedians. CI installs k6 via grafana/setup-k6-action. The compose Postgres\nhost port is now overridable (POSTGRES_HOST_PORT).",
          "timestamp": "2026-07-05T17:31:26+01:00",
          "tree_id": "f5879274467d7f9cee73d99e6b0091738c2576b3",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/17703fc7bca4a5397f37f3d1d9263dd673539a21"
        },
        "date": 1793132183481,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) p50",
            "value": 33.44,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p90",
            "value": 42.67,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p99",
            "value": 66.22,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p50",
            "value": 45.47,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p90",
            "value": 55.28,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p99",
            "value": 79.74,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p50",
            "value": 36.81,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p90",
            "value": 43.14,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p99",
            "value": 63.92,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p50",
            "value": 35.9,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p90",
            "value": 41.79,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p99",
            "value": 59.55,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "committer": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "distinct": true,
          "id": "ab74a526bbda3b645215d263addd3ae3790db89c",
          "message": "feat: export order pipeline, queue, outbox and payment metrics\n\nNew Prometheus series for the questions the existing counters couldn't\nanswer:\n- orders_in_status{status}: live orders per status, read from the DB\n- orders_created_total, order_failures_total{reason}\n- order_stage_duration_seconds{stage}: reservation, payment, completion and\n  Pay -> COMPLETED fulfilment latency\n- payment_authorizations_total{outcome}: authorized, declined,\n  deduplicated, in_flight, takeover\n- rabbitmq_queue_messages / rabbitmq_queue_consumers{queue} for every work\n  queue and the DLQ, plus outbox_pending_messages and\n  outbox_oldest_pending_age_seconds\n\nGauges are served by LiveGaugesService on each scrape (snapshot cached 2s,\ndedicated AMQP channel for checkQueue, degrades to omitting a gauge rather\nthan failing the scrape). Consumer queue names move to shared constants so\nthe gauges check exactly what the consumers declare. Adds Grafana pipeline\npanels and PromQL docs for the new series.",
          "timestamp": "2026-10-27T21:10:03Z",
          "tree_id": "66fea4d76969ea3fd3c7c5f8abceee1c3186f761",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/ab74a526bbda3b645215d263addd3ae3790db89c"
        },
        "date": 1793135690765,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) p50",
            "value": 36.17,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p90",
            "value": 45.09,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p99",
            "value": 75.18,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p50",
            "value": 49.28,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p90",
            "value": 54.79,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p99",
            "value": 78.37,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p50",
            "value": 38.98,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p90",
            "value": 47.36,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p99",
            "value": 67.13,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p50",
            "value": 38.65,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p90",
            "value": 48.84,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p99",
            "value": 63.59,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "committer": {
            "email": "oliverhatherton@gmail.com",
            "name": "Oliver Atherton",
            "username": "oliverhatherton"
          },
          "distinct": true,
          "id": "ff91d8948a0895df94da18bba868eb7fb6708136",
          "message": "feat: add labelled synthetic shopper traffic simulator for demo dashboards\n\nops/traffic-sim.k6.js (pnpm traffic:sim) paces realistic sessions — login,\nbrowse, cart, checkout, wait for RESERVED, then pay (85%) or cancel (15%) and\npoll until the order settles — so the Metrics page and Grafana show the\npipeline working. Every request is marked X-Traffic-Source: synthetic with\na traffic-sim User-Agent, from sim-shopper-<n>@synthetic.example accounts;\neach VU is pinned to its own shopper so concurrent sessions never share a\ncart. Rate, duration, pool size and target are env-configurable.",
          "timestamp": "2026-10-27T21:19:40Z",
          "tree_id": "3e022de50a13712b876e178323f796ccae6112ad",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/ff91d8948a0895df94da18bba868eb7fb6708136"
        },
        "date": 1793136148794,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) p50",
            "value": 23.96,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p90",
            "value": 29.6,
            "unit": "ms"
          },
          {
            "name": "GET /health (unauthenticated baseline) p99",
            "value": 43.99,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p50",
            "value": 35.34,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p90",
            "value": 44.07,
            "unit": "ms"
          },
          {
            "name": "GET /products (authenticated, DB-backed) p99",
            "value": 173.77,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p50",
            "value": 26.84,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p90",
            "value": 32.21,
            "unit": "ms"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) p99",
            "value": 45.71,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p50",
            "value": 26.61,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p90",
            "value": 31.81,
            "unit": "ms"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) p99",
            "value": 49.26,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}