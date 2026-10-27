window.BENCHMARK_DATA = {
  "lastUpdate": 1793131676844,
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
      }
    ]
  }
}