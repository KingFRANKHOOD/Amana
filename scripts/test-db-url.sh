#!/usr/bin/env bash
# test-db-url.sh — Unit tests for scripts/lib/db-url.sh.
#
# Regression guard for issue #1488: password- and query-parameter-carrying
# DATABASE_URLs broke migrate-rollback.sh's maintenance-URL construction,
# producing malformed strings like
#   postgresql://host:5432/amana?sslmode=require/postgres
# which aborted the DROP/CREATE step of a production rollback.
#
# Usage:
#   ./scripts/test-db-url.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/db-url.sh
source "$SCRIPT_DIR/lib/db-url.sh"

FAILURES=0

assert_eq() {
  local description="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $description"
  else
    echo "  ✗ $description"
    echo "      expected: $expected"
    echo "      actual:   $actual"
    ((FAILURES++)) || true
  fi
}

echo "Testing amana_pg_maintenance_url..."
echo ""

# Plain URL — the original supported case.
assert_eq \
  "plain URL drops the database name" \
  "postgresql://postgres:password@localhost:5432/postgres" \
  "$(amana_pg_maintenance_url "postgresql://postgres:password@localhost:5432/amana")"

# The regression: a query string must survive and must not end up after the
# /postgres path in a way that breaks the URL.
assert_eq \
  "URL with ?sslmode=require preserves the query string" \
  "postgresql://user:pass@amana.rds.amazonaws.com:5432/postgres?sslmode=require" \
  "$(amana_pg_maintenance_url "postgresql://user:pass@amana.rds.amazonaws.com:5432/amana?sslmode=require")"

assert_eq \
  "URL with multiple query parameters preserves all of them" \
  "postgresql://user:pass@db.example.com:5432/postgres?sslmode=require&connect_timeout=10" \
  "$(amana_pg_maintenance_url "postgresql://user:pass@db.example.com:5432/amana_staging?sslmode=require&connect_timeout=10")"

# A URL whose database name differs from any hard-coded assumption.
assert_eq \
  "remote database name is replaced regardless of its value" \
  "postgresql://app:secret@10.0.0.5/postgres" \
  "$(amana_pg_maintenance_url "postgresql://app:secret@10.0.0.5/production_db")"

# No port, still fine.
assert_eq \
  "URL without an explicit port" \
  "postgresql://app:secret@db.internal/postgres" \
  "$(amana_pg_maintenance_url "postgresql://app:secret@db.internal/production_db")"

# Already pointing at postgres — idempotent.
assert_eq \
  "URL already targeting postgres stays put" \
  "postgresql://postgres:password@localhost:5432/postgres" \
  "$(amana_pg_maintenance_url "postgresql://postgres:password@localhost:5432/postgres")"

# Fragment alongside a query string.
assert_eq \
  "URL with query string and fragment" \
  "postgresql://user:pass@host:5432/postgres?sslmode=require#primary" \
  "$(amana_pg_maintenance_url "postgresql://user:pass@host:5432/amana?sslmode=require#primary")"

# Host with no database path at all.
assert_eq \
  "URL with no database path appends /postgres" \
  "postgresql://localhost:5432/postgres" \
  "$(amana_pg_maintenance_url "postgresql://localhost:5432")"

echo ""
if (( FAILURES > 0 )); then
  echo "✗ $FAILURES assertion(s) failed"
  exit 1
fi

echo "✓ All amana_pg_maintenance_url assertions passed"
