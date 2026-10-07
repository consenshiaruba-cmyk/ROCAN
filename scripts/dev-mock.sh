#!/usr/bin/env bash
# pnpm dev:mock: the full local stack in mock mode (MOCK_TESTING §1.1).
#   1. docker compose services (postgres+postgis, s3, mailpit), waiting until healthy
#   2. object storage buckets (vault with Object Lock)
#   3. database reset + seed (with dev users)
#   4. web (http://localhost:3000) and worker (http://localhost:3001) with MOCK_MODE=1
set -euo pipefail
cd "$(dirname "$0")/.."

# Check the caller's environment before the env file can override it.
if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "dev:mock refuses to run with NODE_ENV=production" >&2
  exit 1
fi

ENV_FILE=.env
[[ -f $ENV_FILE ]] || ENV_FILE=.env.example
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export MOCK_MODE=1
if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "dev:mock refuses to run with NODE_ENV=production (set in $ENV_FILE)" >&2
  exit 1
fi

echo "▸ starting services"
docker compose up -d --wait

echo "▸ storage buckets"
pnpm --silent storage:init

if [[ "${SKIP_DB_RESET:-0}" != "1" ]]; then
  echo "▸ database reset + seed"
  pnpm --silent db:reset
fi

echo "▸ web  → http://localhost:3000   (healthz, readyz)"
echo "▸ worker → http://localhost:3001 (healthz, readyz)"
echo "▸ mailpit → http://localhost:8025   s3 console → http://localhost:9001"
if [[ "${DEV_MOCK_DETACH:-0}" == "1" ]]; then
  exit 0
fi
exec pnpm exec turbo run dev --filter=@rocan/web --filter=@rocan/worker
