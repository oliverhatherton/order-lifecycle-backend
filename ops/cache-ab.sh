#!/usr/bin/env bash
# Cache on/off A/B under k6. Brings up Postgres/RabbitMQ/Redis via
# docker compose, builds the app, then for each round starts a fresh app
# process with CACHE_ENABLED=true and =false (alternating, so drift over the
# run hits both arms equally) and runs ops/load-test.k6.js against it.
# Prints per-endpoint medians across rounds and the on-vs-off deltas; raw
# per-run reports land in $OUT_DIR.
#
#   ROUNDS=3 LOAD_TEST_DURATION_SECONDS=15 LOAD_TEST_CONNECTIONS=20 pnpm load:cache-ab
set -euo pipefail

cd "$(dirname "$0")/.."
ROUNDS="${ROUNDS:-3}"
PORT="${PORT:-3000}"
# Off the default 5432 so a dev Postgres already on the host doesn't collide.
export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-55432}"
export DB_PORT="$POSTGRES_HOST_PORT"
OUT_DIR="${OUT_DIR:-load-test-results/cache-ab-$(date +%Y%m%dT%H%M%S)}"
mkdir -p "$OUT_DIR"

docker compose up -d --wait postgres rabbitmq redis
pnpm build >/dev/null

APP_PID=""
stop_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID"
    wait "$APP_PID" 2>/dev/null || true
  fi
  APP_PID=""
}
trap stop_app EXIT

run_arm() {
  local arm="$1" round="$2" enabled
  [[ "$arm" == on ]] && enabled=true || enabled=false
  CACHE_ENABLED="$enabled" PORT="$PORT" NODE_ENV=development \
    node dist/main >"$OUT_DIR/app-$arm-$round.log" 2>&1 &
  APP_PID=$!
  LOAD_TEST_BASE_URL="http://localhost:$PORT" \
    LOAD_TEST_OUTPUT="$OUT_DIR/$arm-$round.json" \
    k6 run --quiet ops/load-test.k6.js
  stop_app
}

for round in $(seq 1 "$ROUNDS"); do
  # Alternate which arm goes first each round.
  if (( round % 2 )); then arms=(on off); else arms=(off on); fi
  for arm in "${arms[@]}"; do
    echo "== round $round/$ROUNDS: cache $arm"
    run_arm "$arm" "$round"
  done
done

node ops/cache-ab-report.mjs "$OUT_DIR"
