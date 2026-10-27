window.BENCHMARK_DATA = {
  "lastUpdate": 1793132179457,
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
      }
    ]
  }
}