#!/usr/bin/env bash
# dev-up.sh — Start the Amana local development stack (postgres + redis)
# Usage: ./scripts/dev-up.sh [--reset]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

RESET=false
for arg in "$@"; do
  [[ "$arg" == "--reset" ]] && RESET=true
done

cd "$ROOT_DIR"

if [[ "$RESET" == "true" ]]; then
  echo "→ Resetting dev data volumes..."
  docker compose --profile dev down -v --remove-orphans
fi

echo "→ Starting dev infrastructure..."
docker compose --profile dev up -d

echo "→ Waiting for postgres..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-postgres}" -q; do
  sleep 1
done
echo "  postgres is ready."

echo "→ Waiting for redis..."
until docker compose exec -T redis redis-cli ping | grep -q PONG; do
  sleep 1
done
echo "  redis is ready."

echo "→ Running database migrations..."
cd "$BACKEND_DIR"
npx prisma migrate deploy
cd "$ROOT_DIR"

echo ""
echo "✓ Dev stack is up!"
echo ""
echo "  Postgres : localhost:${POSTGRES_PORT:-5432}  (db: ${POSTGRES_DB:-amana})"
echo "  Redis    : localhost:${REDIS_PORT:-6379}"
echo ""
echo "  Next steps:"
echo "    cd backend  && npm run dev"
echo "    cd frontend && npm run dev"
