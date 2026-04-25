#!/usr/bin/env bash
# staging-up.sh — Start the Amana staging stack with seeded synthetic data
# Usage: ./scripts/staging-up.sh [--reset] [--skip-seed] [--skip-validate]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

RESET=false
SKIP_SEED=false
SKIP_VALIDATE=false

for arg in "$@"; do
  case "$arg" in
    --reset)          RESET=true ;;
    --skip-seed)      SKIP_SEED=true ;;
    --skip-validate)  SKIP_VALIDATE=true ;;
  esac
done

ENV_FILE="$ROOT_DIR/.env.staging"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ENV_FILE"; set +o allexport
  echo "→ Loaded environment from .env.staging"
else
  echo "⚠  .env.staging not found — using default staging credentials."
  echo "   Copy .env.staging.example to .env.staging and fill in values before deploying."
fi

cd "$ROOT_DIR"

if [[ "$RESET" == "true" ]]; then
  echo "→ Resetting staging data volumes..."
  docker compose --profile staging down -v --remove-orphans
fi

echo "→ Starting staging infrastructure..."
docker compose --profile staging up -d

echo "→ Waiting for postgres-staging..."
until docker compose exec -T postgres-staging \
  pg_isready -U "${STAGING_POSTGRES_USER:-postgres}" -q; do
  sleep 1
done
echo "  postgres-staging is ready."

echo "→ Waiting for redis-staging..."
until docker compose exec -T redis-staging redis-cli \
  -a "${STAGING_REDIS_PASSWORD:-staging-redis-pass}" ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
echo "  redis-staging is ready."

echo "→ Running database migrations..."
cd "$BACKEND_DIR"
DATABASE_URL="${STAGING_DATABASE_URL:-postgresql://postgres:staging-password@localhost:5434/amana_staging}" \
  npx prisma migrate deploy

if [[ "$SKIP_SEED" == "false" ]]; then
  echo "→ Seeding staging data..."
  DATABASE_URL="${STAGING_DATABASE_URL:-postgresql://postgres:staging-password@localhost:5434/amana_staging}" \
    npx tsx prisma/seed.staging.ts
fi

cd "$ROOT_DIR"

if [[ "$SKIP_VALIDATE" == "false" ]]; then
  echo "→ Running staging validation checks..."
  "$SCRIPT_DIR/staging-validate.sh"
fi

echo ""
echo "✓ Staging stack is up!"
echo ""
echo "  Postgres : localhost:${STAGING_POSTGRES_PORT:-5434}  (db: amana_staging)"
echo "  Redis    : localhost:${STAGING_REDIS_PORT:-6380}"
