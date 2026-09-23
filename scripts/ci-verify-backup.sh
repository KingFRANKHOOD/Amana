#!/usr/bin/env bash
# ci-verify-backup.sh — CI-only end-to-end backup verification (issue #1100).
#
# Runs against the throwaway Postgres service provisioned by
# .github/workflows/backup-verify.yml. It:
#   1. Seeds a source database with tables, foreign keys and data.
#   2. Runs the REAL backup script (db-backup.sh --dry-run), which exercises
#      the full pg_dump -> gzip -> GPG-encrypt pipeline and only skips the
#      S3 upload that needs real cloud credentials.
#   3. Restores a freshly taken dump into a scratch database and applies the
#      same integrity checks verify-backup.sh uses on production backups:
#        - every source table exists in the restored dump
#        - per-table row counts match
#        - no orphaned foreign keys
#        - latest created_at survives the round trip
#   4. Destroys the scratch database and ephemeral GPG keyring on exit.
#
# Usage (normally invoked by CI):
#   DATABASE_URL=postgresql://... ./scripts/ci-verify-backup.sh
#
# Required env:
#   DATABASE_URL   — PostgreSQL connection string for the SOURCE database.
# Optional env:
#   S3_BUCKET      — used only to satisfy db-backup.sh; upload is dry-run.
#
# Exit code 0 only if every check below passes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

: "${DATABASE_URL:?DATABASE_URL is required (source database)}"

# Capture the database name so gpg/restore assertions can reference it.
SRC_DB="${DATABASE_URL##*/}"
SRC_DB="${SRC_DB%%\?*}"
if [[ -z "$SRC_DB" || "$SRC_DB" == "postgres" ]]; then
  echo "[ci-verify-backup] ERROR: DATABASE_URL must name a dedicated database, not 'postgres'." >&2
  exit 1
fi

VERIFY_DB_NAME="${SRC_DB}_verify"
BASE_URL="${DATABASE_URL%/*}"
VERIFY_DATABASE_URL="${BASE_URL}/${VERIFY_DB_NAME}"
# Same server, dbname=postgres — lets us CREATE/DROP the scratch database
# without connecting to the database being dropped.
MAINT_URL="${BASE_URL}/postgres"

# Ephemeral GPG keyring + recipient used only for the encrypt round trip.
export GNUPGHOME="$(mktemp -d)"
export GPG_RECIPIENT="${GPG_RECIPIENT:-ci-backup@amana.local}"
export S3_BUCKET="${S3_BUCKET:-ci-backup-verification-bucket}"
chmod 700 "$GNUPGHOME"

WORKDIR="$(mktemp -d)"
FAILED=false

cleanup() {
  rm -rf "$WORKDIR" "$GNUPGHOME"
  if [[ "$FAILED" == "true" ]]; then
    # Leave the scratch DB for inspection; the next run drops it again.
    return
  fi
  psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c \
    "DROP DATABASE IF EXISTS \"$VERIFY_DB_NAME\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  FAILED=true
  echo "[ci-verify-backup] CHECK FAILED: $1" >&2
}

# --- Seed the source database with schema + data (FKs and fresh timestamps). ---
echo "[ci-verify-backup] Seeding source database $SRC_DB..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id         serial PRIMARY KEY,
  wallet     text UNIQUE NOT NULL,
  role       text NOT NULL DEFAULT 'buyer',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trades (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id),
  amount     numeric(20,7) NOT NULL,
  status     text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO users (wallet, role, created_at) VALUES
  ('GBASEUSER0000000000000000000000000000000000000000', 'buyer',  now() - interval '14 days'),
  ('GBASEUSER1111111111111111111111111111111111111111', 'seller', now() - interval '10 days'),
  ('GBASEUSER2222222222222222222222222222222222222222', 'driver', now() - interval '3 days');
INSERT INTO trades (user_id, amount, status, created_at)
SELECT
  (random() * 2)::int + 1,
  (random() * 1000)::numeric(20,7),
  (ARRAY['OPEN','FUNDED','DELIVERED','SETTLED'])[floor(random() * 4 + 1)],
  now() - (random() * interval '13 days')
FROM generate_series(1, 500);
INSERT INTO trades (user_id, amount, status) VALUES (1, 42.42, 'OPEN');
SQL

# --- Exercise the real backup script (pg_dump + gzip + GPG, no S3 upload).
#     A failure in any stage fails the job because the script exits non-zero. ---
echo "[ci-verify-backup] Generating ephemeral GPG key for $GPG_RECIPIENT..."
gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key \
  "$GPG_RECIPIENT" default default 1d >/dev/null 2>&1

echo "[ci-verify-backup] Running db-backup.sh --type=daily --dry-run..."
"$SCRIPT_DIR/db-backup.sh" --type=daily --dry-run

# --- Take our own dump, encrypt AND decrypt it, then restore it into a
#     scratch database so the integrity checks run against the restored data. ---
echo "[ci-verify-backup] Taking a gzip dump and GPG round trip..."
DUMP="$WORKDIR/dump.sql"
pg_dump "$DATABASE_URL" | gzip -9 > "$DUMP.gz"
gpg --batch --yes --trust-model always \
  --recipient "$GPG_RECIPIENT" \
  --output "$DUMP.gz.gpg" \
  --encrypt "$DUMP.gz"
gpg --batch --yes \
  --output "$DUMP.gz.restored.gpg" \
  --decrypt "$DUMP.gz.gpg"
gzip -dc "$DUMP.gz.restored.gpg" > "$DUMP.restored"

echo "[ci-verify-backup] Restoring into scratch database $VERIFY_DB_NAME..."
psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"$VERIFY_DB_NAME\" WITH (FORCE);" >/dev/null
psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE \"$VERIFY_DB_NAME\";" >/dev/null
psql "$VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 -q < "$DUMP.restored"

# --- Check 1: every source table exists in the restored dump. ---
echo "[ci-verify-backup] Checking tables exist in the restored dump..."
SRC_TABLES=$(psql "$DATABASE_URL" -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")
RESTORED_TABLES=$(psql "$VERIFY_DATABASE_URL" -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")
while IFS= read -r TABLE; do
  [[ -z "$TABLE" ]] && continue
  if ! grep -qx "$TABLE" <<< "$RESTORED_TABLES"; then
    fail "table '$TABLE' is missing from the restored dump"
  else
    echo "  table $TABLE present"
  fi
done <<< "$SRC_TABLES"

# --- Check 2: per-table row counts match the source exactly. ---
echo "[ci-verify-backup] Checking row counts match..."
while IFS= read -r TABLE; do
  [[ -z "$TABLE" ]] && continue
  SRC_COUNT=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM \"$TABLE\";")
  RESTORED_COUNT=$(psql "$VERIFY_DATABASE_URL" -Atc "SELECT count(*) FROM \"$TABLE\";")
  if [[ "$SRC_COUNT" != "$RESTORED_COUNT" ]]; then
    fail "table '$TABLE' row count mismatch: source=$SRC_COUNT restored=$RESTORED_COUNT"
  else
    echo "  $TABLE: $SRC_COUNT rows (match)"
  fi
done <<< "$SRC_TABLES"

# --- Check 3: no orphaned foreign keys in the restored dump. ---
echo "[ci-verify-backup] Checking referential integrity (no orphaned FKs)..."
FK_CONSTRAINTS=$(psql "$VERIFY_DATABASE_URL" -Atc "
  SELECT
    tc.table_name || '|' || kcu.column_name || '|' ||
    ccu.table_name || '|' || ccu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
")
while IFS='|' read -r CHILD_TABLE CHILD_COL PARENT_TABLE PARENT_COL; do
  [[ -z "$CHILD_TABLE" ]] && continue
  ORPHANS=$(psql "$VERIFY_DATABASE_URL" -Atc "
    SELECT count(*) FROM \"$CHILD_TABLE\" c
    WHERE c.\"$CHILD_COL\" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM \"$PARENT_TABLE\" p WHERE p.\"$PARENT_COL\" = c.\"$CHILD_COL\"
      );
  ")
  if (( ORPHANS > 0 )); then
    fail "$ORPHANS orphaned row(s) in '$CHILD_TABLE.$CHILD_COL' referencing missing '$PARENT_TABLE.$PARENT_COL'"
  else
    echo "  $CHILD_TABLE.$CHILD_COL -> $PARENT_TABLE.$PARENT_COL: no orphans"
  fi
done <<< "$FK_CONSTRAINTS"

# --- Check 4: latest created_at survives the round trip. ---
echo "[ci-verify-backup] Checking freshest created_at matches..."
SRC_LATEST=$(psql "$DATABASE_URL" -Atc "SELECT max(created_at) FROM trades;")
RESTORED_LATEST=$(psql "$VERIFY_DATABASE_URL" -Atc "SELECT max(created_at) FROM trades;")
if [[ "$SRC_LATEST" != "$RESTORED_LATEST" ]]; then
  fail "trades max(created_at) mismatch: source=$SRC_LATEST restored=$RESTORED_LATEST"
else
  echo "  trades max(created_at): $SRC_LATEST (match)"
fi

if [[ "$FAILED" == "true" ]]; then
  echo "[ci-verify-backup] FAILED — one or more checks failed." >&2
  exit 1
fi

echo "[ci-verify-backup] All checks passed. Backup pipeline is restorable and consistent."