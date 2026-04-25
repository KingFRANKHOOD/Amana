#!/usr/bin/env bash
# migrate-rollback.sh — Roll back the most recently applied Prisma migration.
#
# Prisma does not have native rollback support.
# This script implements rollback by:
#   1. Restoring from a pre-migration backup (preferred, --from-backup)
#   2. Applying a hand-written rollback SQL file (--from-sql)
#   3. Marking a migration as "rolled back" without schema changes (--mark-rolled-back)
#
# Usage:
#   ./scripts/migrate-rollback.sh --from-backup backups/pre-migration-20260424-120000.sql.gz
#   ./scripts/migrate-rollback.sh --from-sql backend/prisma/migrations/<name>/rollback.sql
#   ./scripts/migrate-rollback.sh --mark-rolled-back <migration_name>
#
# IMPORTANT: Always test rollback in staging before using in production.
# See docs/migration-rollback-playbook.md for the full procedure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ROOT_DIR/backend"

MODE=""
TARGET=""
ENV="staging"

for arg in "$@"; do
  case "$arg" in
    --from-backup=*)       MODE="backup"; TARGET="${arg#--from-backup=}" ;;
    --from-sql=*)          MODE="sql";    TARGET="${arg#--from-sql=}" ;;
    --mark-rolled-back=*)  MODE="mark";   TARGET="${arg#--mark-rolled-back=}" ;;
    --env=*)               ENV="${arg#--env=}" ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Usage:"
  echo "  $0 --from-backup=<backup-file>"
  echo "  $0 --from-sql=<rollback.sql>"
  echo "  $0 --mark-rolled-back=<migration_name>"
  exit 1
fi

if [[ -f "$ROOT_DIR/.env.$ENV" ]]; then
  # shellcheck disable=SC1090
  set -o allexport; source "$ROOT_DIR/.env.$ENV"; set +o allexport
fi
DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/amana}"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Amana — Migration Rollback  (env: $ENV, mode: $MODE)"
echo "═══════════════════════════════════════════════════════════════"

# Safety gate for production
if [[ "$ENV" == "production" ]]; then
  echo ""
  echo "  ⚠  WARNING: You are rolling back a PRODUCTION database."
  echo "     This will cause data loss if new rows were inserted after the migration."
  echo ""
  read -r -p "  Type 'rollback production' to confirm: " confirm
  if [[ "$confirm" != "rollback production" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

case "$MODE" in
  # ── Restore from pg_dump backup ────────────────────────────────────────────
  backup)
    if [[ ! -f "$TARGET" ]]; then
      echo "  ✗ Backup file not found: $TARGET"
      exit 1
    fi
    echo ""
    echo "  → Restoring from backup: $TARGET"
    echo "  → Dropping and recreating database..."
    DB_NAME=$(psql "$DB_URL" -At -c "SELECT current_database()")
    DB_HOST_URL="${DB_URL%/$DB_NAME}"
    psql "$DB_HOST_URL/postgres" -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -q
    psql "$DB_HOST_URL/postgres" -c "CREATE DATABASE \"$DB_NAME\";" -q
    echo "  → Restoring data..."
    if [[ "$TARGET" == *.gz ]]; then
      gunzip -c "$TARGET" | psql "$DB_URL" -q
    else
      psql "$DB_URL" -f "$TARGET" -q
    fi
    echo "  ✓ Backup restored successfully"
    ;;

  # ── Apply hand-written rollback SQL ────────────────────────────────────────
  sql)
    if [[ ! -f "$TARGET" ]]; then
      echo "  ✗ Rollback SQL file not found: $TARGET"
      exit 1
    fi
    echo ""
    echo "  → Applying rollback SQL: $TARGET"
    psql "$DB_URL" -f "$TARGET"
    echo "  ✓ Rollback SQL applied"

    # Mark migration as rolled back in Prisma's tracking table
    MIGRATION_NAME=$(basename "$(dirname "$TARGET")")
    echo "  → Marking migration '$MIGRATION_NAME' as rolled back..."
    psql "$DB_URL" -c "
      UPDATE _prisma_migrations
      SET rolled_back_at = NOW()
      WHERE migration_name = '$MIGRATION_NAME'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL;
    " -q
    echo "  ✓ Migration marked as rolled back"
    ;;

  # ── Mark rolled back (schema unchanged) ────────────────────────────────────
  mark)
    echo ""
    echo "  → Marking migration '$TARGET' as rolled back (no schema changes)..."
    cd "$BACKEND_DIR"
    DATABASE_URL="$DB_URL" npx prisma migrate resolve --rolled-back "$TARGET"
    echo "  ✓ Migration marked as rolled back in Prisma"
    ;;
esac

echo ""
echo "[Post-rollback] Verifying database connectivity..."
if psql "$DB_URL" -c "SELECT 1" -q >/dev/null 2>&1; then
  echo "  ✓ Database is accessible after rollback"
else
  echo "  ✗ Database is NOT accessible after rollback. Manual intervention required."
  exit 1
fi

echo ""
echo "  ✅ Rollback complete."
echo ""
echo "  Next steps:"
echo "    1. Run application smoke tests against the rolled-back schema."
echo "    2. Verify no data loss using the staging-validate script."
echo "    3. File a post-mortem with root cause and timeline."
echo "    4. See docs/migration-rollback-playbook.md for the full procedure."
