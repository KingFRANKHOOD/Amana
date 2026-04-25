#!/usr/bin/env bash
# staging-validate.sh — Deploy validation checks for the staging environment.
#
# Verifies the staging database is healthy and contains expected seed data
# before promoting a staging build to production.
#
# Usage:
#   ./scripts/staging-validate.sh
#   DATABASE_URL=<staging-url> ./scripts/staging-validate.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
set -euo pipefail

DB_URL="${STAGING_DATABASE_URL:-postgresql://postgres:staging-password@localhost:5434/amana_staging}"

PASS=0
FAIL=0

check() {
  local label="$1"
  local query="$2"
  local expected="$3"

  local actual
  actual=$(psql "$DB_URL" -At -c "$query" 2>&1)

  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $label"
    ((PASS++)) || true
  else
    echo "  ✗ $label  (expected: $expected, got: $actual)"
    ((FAIL++)) || true
  fi
}

check_gte() {
  local label="$1"
  local query="$2"
  local min="$3"

  local actual
  actual=$(psql "$DB_URL" -At -c "$query" 2>&1)

  if [[ "$actual" -ge "$min" ]] 2>/dev/null; then
    echo "  ✓ $label (count=$actual, min=$min)"
    ((PASS++)) || true
  else
    echo "  ✗ $label (expected >= $min, got: $actual)"
    ((FAIL++)) || true
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Amana — Staging Validation Checks"
echo "═══════════════════════════════════════════════════════════════"

# ── Connectivity ─────────────────────────────────────────────────────────────
echo ""
echo "[1] Database connectivity"
if psql "$DB_URL" -c "SELECT 1" -q >/dev/null 2>&1; then
  echo "  ✓ Connected to staging postgres"
  ((PASS++)) || true
else
  echo "  ✗ Cannot connect to staging postgres at: $DB_URL"
  ((FAIL++)) || true
fi

# ── Schema / migrations ───────────────────────────────────────────────────────
echo ""
echo "[2] Schema health"
check "User table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='User'" "1"
check "Trade table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='Trade'" "1"
check "Dispute table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='Dispute'" "1"
check "ProcessedEvent table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='ProcessedEvent'" "1"
check "Vault table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='Vault'" "1"
check "Goal table exists" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='Goal'" "1"

# ── Seed data presence ────────────────────────────────────────────────────────
echo ""
echo "[3] Seed data"
check_gte "At least 5 users seeded"      'SELECT COUNT(*) FROM "User"'           5
check_gte "At least 8 trades seeded"     'SELECT COUNT(*) FROM "Trade"'          8
check_gte "At least 4 disputes seeded"   'SELECT COUNT(*) FROM "Dispute"'        4
check_gte "At least 1 manifest seeded"   'SELECT COUNT(*) FROM "DeliveryManifest"' 1
check_gte "At least 2 evidence seeded"   'SELECT COUNT(*) FROM "TradeEvidence"'  2
check_gte "At least 10 events seeded"    'SELECT COUNT(*) FROM "ProcessedEvent"' 10
check_gte "At least 2 vaults seeded"     'SELECT COUNT(*) FROM "Vault"'          2
check_gte "At least 4 goals seeded"      'SELECT COUNT(*) FROM "Goal"'           4

# ── Trade status coverage ─────────────────────────────────────────────────────
echo ""
echo "[4] Trade status coverage"
for status in PENDING_SIGNATURE CREATED FUNDED DELIVERED COMPLETED CANCELLED DISPUTED; do
  count=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM \"Trade\" WHERE status='$status'" 2>/dev/null || echo 0)
  if [[ "$count" -ge 1 ]]; then
    echo "  ✓ At least 1 trade with status=$status"
    ((PASS++)) || true
  else
    echo "  ✗ No trade with status=$status"
    ((FAIL++)) || true
  fi
done

# ── Dispute status coverage ───────────────────────────────────────────────────
echo ""
echo "[5] Dispute status coverage"
for status in OPEN UNDER_REVIEW RESOLVED CLOSED; do
  count=$(psql "$DB_URL" -At -c "SELECT COUNT(*) FROM \"Dispute\" WHERE status='$status'" 2>/dev/null || echo 0)
  if [[ "$count" -ge 1 ]]; then
    echo "  ✓ At least 1 dispute with status=$status"
    ((PASS++)) || true
  else
    echo "  ✗ No dispute with status=$status"
    ((FAIL++)) || true
  fi
done

# ── Referential integrity ─────────────────────────────────────────────────────
echo ""
echo "[6] Referential integrity"
check "No orphaned disputes" \
  'SELECT COUNT(*) FROM "Dispute" d LEFT JOIN "Trade" t ON d."tradeId"=t."tradeId" WHERE t.id IS NULL' "0"
check "No orphaned goals" \
  'SELECT COUNT(*) FROM "Goal" g LEFT JOIN "Vault" v ON g."vaultId"=v."vaultId" WHERE v.id IS NULL' "0"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "❌ Staging validation FAILED. Do not promote to production."
  exit 1
else
  echo "✅ All staging checks passed. Safe to promote."
fi
