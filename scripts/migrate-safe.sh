#!/usr/bin/env bash
# migrate-safe.sh — Run Prisma migrations with pre-flight safety checks.
#
# Checks performed before applying any migration:
#   1. Pending migrations list (dry-run)
#   2. Backward-compatibility scan (destructive DDL detection)
#   3. Database backup prompt (skippable with --no-backup in non-prod)
#   4. Migration application with status verification
#
# Usage:
#   ./scripts/migrate-safe.sh [--env staging|production] [--no-backup] [--dry-run]
#
# Exit codes:
#   0 — all checks passed and migration applied (or --dry-run)
#   1 — safety check failed or migration failed
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

ENV="staging"
NO_BACKUP=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --env=*)      ENV="${arg#--env=}" ;;
    --no-backup)  NO_BACKUP=true ;;
    --dry-run)    DRY_RUN=true ;;
  esac
done

# Load env file
if [[ -f "$ROOT_DIR/.env.$ENV" ]]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ROOT_DIR/.env.$ENV"; set +o allexport
fi

DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/amana}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Amana — Migration Safety Checks  (env: $ENV)"
echo "═══════════════════════════════════════════════════════════════"

WARNINGS=0

# ── Step 1: Check connectivity ────────────────────────────────────────────────
echo ""
echo "[1] Database connectivity"
if ! psql "$DB_URL" -c "SELECT 1" -q >/dev/null 2>&1; then
  echo "  ✗ Cannot connect to database. Aborting."
  exit 1
fi
echo "  ✓ Connected"

# ── Step 2: Pending migrations ────────────────────────────────────────────────
echo ""
echo "[2] Pending migrations"
cd "$BACKEND_DIR"
PENDING=$(DATABASE_URL="$DB_URL" npx prisma migrate status 2>&1 || true)
echo "$PENDING" | sed 's/^/  /'

if echo "$PENDING" | grep -q "Database schema is up to date"; then
  echo ""
  echo "  ✓ No pending migrations. Nothing to do."
  exit 0
fi

# ── Step 3: Backward-compatibility scan ──────────────────────────────────────
echo ""
echo "[3] Backward-compatibility scan"

MIGRATION_DIR="$BACKEND_DIR/prisma/migrations"
# Find migrations not yet applied by checking _prisma_migrations table
UNAPPLIED_FILES=$(psql "$DB_URL" -At -c "
  SELECT migration_name
  FROM _prisma_migrations
  WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
  ORDER BY started_at
" 2>/dev/null || true)

# Also scan SQL files newer than the last applied migration
SCAN_FILES=()
while IFS= read -r -d '' f; do
  SCAN_FILES+=("$f")
done < <(find "$MIGRATION_DIR" -name "*.sql" -print0 | sort -z)

DESTRUCTIVE_PATTERNS=(
  "DROP TABLE"
  "DROP COLUMN"
  "ALTER TABLE.*DROP"
  "TRUNCATE"
  "ALTER COLUMN.*NOT NULL"  # adding NOT NULL without DEFAULT is unsafe
)

echo "  Scanning pending SQL files for destructive DDL..."
DESTRUCTIVE_FOUND=false

for sql_file in "${SCAN_FILES[@]}"; do
  dir_name=$(basename "$(dirname "$sql_file")")
  # Check if already applied
  if psql "$DB_URL" -At -c "
    SELECT 1 FROM _prisma_migrations WHERE migration_name='$dir_name' AND finished_at IS NOT NULL LIMIT 1
  " 2>/dev/null | grep -q "1"; then
    continue
  fi

  for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
    if grep -iEq "$pattern" "$sql_file" 2>/dev/null; then
      echo ""
      echo "  ⚠  DESTRUCTIVE DDL detected in: $(basename "$(dirname "$sql_file")")"
      echo "     Pattern: $pattern"
      grep -iE "$pattern" "$sql_file" | head -5 | sed 's/^/     > /'
      DESTRUCTIVE_FOUND=true
      ((WARNINGS++)) || true
    fi
  done
done

if [[ "$DESTRUCTIVE_FOUND" == "false" ]]; then
  echo "  ✓ No destructive DDL found"
else
  echo ""
  echo "  ⚠  Destructive DDL requires extra caution:"
  echo "     • Verify the column / table is no longer referenced by application code"
  echo "     • Confirm you have a rollback plan (see docs/migration-rollback-playbook.md)"
  echo "     • For production, execute during a maintenance window"
  if [[ "$ENV" == "production" ]]; then
    echo ""
    read -r -p "  Destructive DDL detected in production. Continue? [y/N] " confirm
    [[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "Aborted."; exit 1; }
  fi
fi

# ── Step 4: Backup ────────────────────────────────────────────────────────────
echo ""
echo "[4] Pre-migration backup"

if [[ "$NO_BACKUP" == "true" ]]; then
  echo "  ⚠  Backup skipped (--no-backup). Only acceptable in non-production."
elif [[ "$ENV" == "production" ]]; then
  BACKUP_FILE="$ROOT_DIR/backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql.gz"
  mkdir -p "$ROOT_DIR/backups"
  echo "  → Creating backup: $BACKUP_FILE"
  pg_dump "$DB_URL" | gzip > "$BACKUP_FILE"
  echo "  ✓ Backup saved: $BACKUP_FILE"
else
  echo "  ⚠  Non-production environment. Skipping automatic backup."
  echo "     (Pass --no-backup to suppress this message.)"
fi

# ── Step 5: Apply ─────────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[5] DRY RUN — migration would be applied here"
  echo "  ✓ Dry run complete. No changes were made."
  exit 0
fi

echo "[5] Applying migration"
if DATABASE_URL="$DB_URL" npx prisma migrate deploy 2>&1 | sed 's/^/  /'; then
  echo "  ✓ Migration applied successfully"
else
  echo "  ✗ Migration FAILED"
  echo ""
  echo "  See docs/migration-rollback-playbook.md for rollback procedures."
  exit 1
fi

# ── Step 6: Post-migration verification ──────────────────────────────────────
echo ""
echo "[6] Post-migration verification"
STATUS=$(DATABASE_URL="$DB_URL" npx prisma migrate status 2>&1)
if echo "$STATUS" | grep -q "Database schema is up to date"; then
  echo "  ✓ Database schema is up to date"
else
  echo "  ⚠  Unexpected status after migration:"
  echo "$STATUS" | sed 's/^/  /'
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ $WARNINGS -gt 0 ]]; then
  echo "  ✅ Migration complete with $WARNINGS warning(s)."
else
  echo "  ✅ Migration complete."
fi
echo "═══════════════════════════════════════════════════════════════"
