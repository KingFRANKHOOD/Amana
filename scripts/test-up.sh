#!/usr/bin/env bash
# test-up.sh — Start ephemeral test infrastructure (tmpfs postgres + redis)
# Usage: ./scripts/test-up.sh [--down]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

DOWN=false
for arg in "$@"; do
  [[ "$arg" == "--down" ]] && DOWN=true
done

cd "$ROOT_DIR"

if [[ "$DOWN" == "true" ]]; then
  echo "→ Tearing down test infrastructure..."
  docker compose --profile test down --remove-orphans
  exit 0
fi

echo "→ Starting test infrastructure (ephemeral)..."
docker compose --profile test up -d

echo "→ Waiting for postgres-test..."
until docker compose exec -T postgres-test pg_isready -U postgres -q; do
  sleep 1
done
echo "  postgres-test is ready."

echo "→ Waiting for redis-test..."
until docker compose exec -T redis-test redis-cli ping | grep -q PONG; do
  sleep 1
done
echo "  redis-test is ready."

echo "→ Applying migrations to test database..."
cd "$BACKEND_DIR"
DATABASE_URL="postgresql://postgres:password@localhost:${TEST_POSTGRES_PORT:-5433}/amana_test" \
  npx prisma migrate deploy
cd "$ROOT_DIR"

echo ""
echo "✓ Test stack is up!"
echo ""
echo "  Postgres (test) : localhost:${TEST_POSTGRES_PORT:-5433}  (db: amana_test)"
echo "  Redis (test)    : localhost:${TEST_REDIS_PORT:-6381}"
echo ""
echo "  Run tests with:"
echo "    DATABASE_URL=postgresql://postgres:password@localhost:${TEST_POSTGRES_PORT:-5433}/amana_test \\"
echo "    REDIS_URL=redis://localhost:${TEST_REDIS_PORT:-6381} \\"
echo "    cd backend && npm test"
echo ""
echo "  Tear down with: ./scripts/test-up.sh --down"
