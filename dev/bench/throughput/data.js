window.BENCHMARK_DATA = {
  "lastUpdate": 1793140684784,
  "repoUrl": "https://github.com/oliverhatherton/order-lifecycle-backend",
  "entries": {
    "Load test — throughput": [
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
        "date": 1783037887140,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 613.3,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 383.2,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside) req/sec",
            "value": 588.4,
            "unit": "req/sec"
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
        "date": 1793131672655,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 1204.8,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 705.1,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 1149.5,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 1162.2,
            "unit": "req/sec"
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
        "date": 1793132178352,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 608.4,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 441.2,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 565.1,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 576.9,
            "unit": "req/sec"
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
        "date": 1793135688347,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 564.6,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 416,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 530.1,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 531.7,
            "unit": "req/sec"
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
        "date": 1793136147123,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 884.8,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 522,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 789.7,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 780.3,
            "unit": "req/sec"
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
          "id": "6439e4ee587dd04417ce73810baac3b3a8870693",
          "message": "ci: run the synthetic traffic simulator intermittently against the demo API\n\nScheduled every 2h at an odd minute; ~1 in 4 slots are skipped at random and\neach run picks a random 8-20 minute length at 2-4 sessions/min, so the demo\ndashboards keep showing labelled synthetic activity without clockwork\npatterns. Wakes the sleeping Render instance first, never overlaps runs, and\ncan be triggered manually with an explicit length and rate. Target and\naccount password come from vars.SIM_BASE_URL / secrets.SIM_PASSWORD.",
          "timestamp": "2026-10-27T21:29:00Z",
          "tree_id": "f75b25ac348f2900d5aa26b6b6eed18299f472bf",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/6439e4ee587dd04417ce73810baac3b3a8870693"
        },
        "date": 1793136711003,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 577.5,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 433.6,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 551.5,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 555.2,
            "unit": "req/sec"
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
          "id": "00205f833c5a9fb8867a5a5b091fc8865011138f",
          "message": "feat: motorsport shop catalog; retire the placeholder products\n\nSeeds 18 motorsport products (driver kit, car parts, track-day gear) with\nbelievable stock levels. The old widget SKUs are retired rather than\ndeleted, since past order items reference them: a new products.active\ncolumn (with migration) hides them from the shop, the cart and stock\nreplenishment, and the seeder clears them from any open cart.",
          "timestamp": "2026-10-27T22:35:27Z",
          "tree_id": "eaab0b45f5207c07668a30609cb8f6c6c1c6c563",
          "url": "https://github.com/oliverhatherton/order-lifecycle-backend/commit/00205f833c5a9fb8867a5a5b091fc8865011138f"
        },
        "date": 1793140684187,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "GET /health (unauthenticated baseline) req/sec",
            "value": 650.3,
            "unit": "req/sec"
          },
          {
            "name": "GET /products (authenticated, DB-backed) req/sec",
            "value": 443,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders (authenticated, cache-aside list) req/sec",
            "value": 586.3,
            "unit": "req/sec"
          },
          {
            "name": "GET /orders/:id (authenticated, cache-aside by id) req/sec",
            "value": 622.5,
            "unit": "req/sec"
          }
        ]
      }
    ]
  }
}