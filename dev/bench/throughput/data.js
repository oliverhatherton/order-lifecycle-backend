window.BENCHMARK_DATA = {
  "lastUpdate": 1783037887674,
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
      }
    ]
  }
}