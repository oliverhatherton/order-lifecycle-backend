window.BENCHMARK_DATA = {
  "lastUpdate": 1783037889370,
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
      }
    ]
  }
}