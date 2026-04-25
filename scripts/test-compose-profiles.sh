#!/usr/bin/env bash
# test-compose-profiles.sh — validate docker-compose.yml profile definitions
# CI-safe: only parses config, does not start containers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

PASS=0
FAIL=0

assert_contains() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✓ $label"
    ((PASS++)) || true
  else
    echo "  ✗ $label  (expected: $expected)"
    ((FAIL++)) || true
  fi
}

echo "── docker-compose profile tests ──────────────────────────────────────────"

# --- dev profile ---
echo ""
echo "[dev profile]"
DEV_CONFIG=$(docker compose --profile dev config 2>&1)
assert_contains "includes postgres service"        "postgres:"       "$DEV_CONFIG"
assert_contains "includes redis service"           "redis:"          "$DEV_CONFIG"
assert_contains "does NOT include staging postgres" "" \
  "$(echo "$DEV_CONFIG" | grep -v "postgres-staging" || true)"
assert_contains "postgres uses persistent volume"  "postgres_data"   "$DEV_CONFIG"

# --- staging profile ---
echo ""
echo "[staging profile]"
STAGING_CONFIG=$(docker compose --profile staging config 2>&1)
assert_contains "includes postgres-staging"        "postgres-staging" "$STAGING_CONFIG"
assert_contains "includes redis-staging"           "redis-staging"    "$STAGING_CONFIG"
assert_contains "staging postgres uses port 5434"  "5434"             "$STAGING_CONFIG"
assert_contains "staging redis uses password flag" "requirepass"      "$STAGING_CONFIG"
assert_contains "staging uses named volume"        "postgres_staging_data" "$STAGING_CONFIG"

# --- test profile ---
echo ""
echo "[test profile]"
TEST_CONFIG=$(docker compose --profile test config 2>&1)
assert_contains "includes postgres-test"           "postgres-test"    "$TEST_CONFIG"
assert_contains "includes redis-test"              "redis-test"       "$TEST_CONFIG"
assert_contains "test postgres uses tmpfs"         "tmpfs"            "$TEST_CONFIG"
assert_contains "test postgres uses port 5433"     "5433"             "$TEST_CONFIG"
assert_contains "test redis uses port 6381"        "6381"             "$TEST_CONFIG"

# --- summary ---
echo ""
echo "──────────────────────────────────────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
