#!/usr/bin/env bash
# db-backup.sh — pg_dump, compress, GPG-encrypt, upload to S3, apply retention policy.
#
# Usage:
#   ./scripts/db-backup.sh [--type daily|weekly|monthly] [--dry-run]
#
# Required env:
#   DATABASE_URL        — PostgreSQL connection string
#   GPG_RECIPIENT       — GPG key fingerprint/email for encryption
#   S3_BUCKET           — S3 bucket name
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION (or use IAM role)
#
# Optional env:
#   S3_ENDPOINT         — S3-compatible endpoint (e.g. MinIO)
#   S3_PREFIX           — key prefix inside the bucket (default: backups)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

BACKUP_TYPE="daily"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --type=*)   BACKUP_TYPE="${arg#--type=}" ;;
    --dry-run)  DRY_RUN=true ;;
  esac
done

if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -o allexport; source "$ROOT_DIR/.env"; set +o allexport
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${GPG_RECIPIENT:?GPG_RECIPIENT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

S3_PREFIX="${S3_PREFIX:-backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="amana-${BACKUP_TYPE}-${TIMESTAMP}.sql.gz.gpg"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

DUMP_FILE="$TMPDIR/dump.sql.gz"
ENCRYPTED_FILE="$TMPDIR/$FILENAME"

echo "[backup] Running pg_dump → $BACKUP_TYPE/$FILENAME"
pg_dump "$DATABASE_URL" | gzip -9 > "$DUMP_FILE"

echo "[backup] Encrypting with GPG (recipient: $GPG_RECIPIENT)"
gpg --batch --yes --trust-model always \
    --recipient "$GPG_RECIPIENT" \
    --output "$ENCRYPTED_FILE" \
    --encrypt "$DUMP_FILE"

S3_KEY="$S3_PREFIX/$BACKUP_TYPE/$FILENAME"

AWS_ARGS=()
if [[ -n "${S3_ENDPOINT:-}" ]]; then
  AWS_ARGS+=(--endpoint-url "$S3_ENDPOINT")
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[backup] DRY RUN — would upload to s3://$S3_BUCKET/$S3_KEY"
else
  echo "[backup] Uploading to s3://$S3_BUCKET/$S3_KEY"
  aws "${AWS_ARGS[@]}" s3 cp "$ENCRYPTED_FILE" "s3://$S3_BUCKET/$S3_KEY" \
      --storage-class STANDARD_IA
  echo "[backup] Upload complete."
fi

# --- Retention policy ---
# daily: 7, weekly: 4, monthly: 12
declare -A KEEP=([daily]=7 [weekly]=4 [monthly]=12)
MAX_KEEP="${KEEP[$BACKUP_TYPE]:-7}"

echo "[backup] Applying retention: keep last $MAX_KEEP $BACKUP_TYPE backups"

if [[ "$DRY_RUN" != "true" ]]; then
  EXISTING=$(aws "${AWS_ARGS[@]}" s3 ls "s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_TYPE/" \
      | awk '{print $4}' | sort)
  COUNT=$(echo "$EXISTING" | grep -c '.' || true)

  if (( COUNT > MAX_KEEP )); then
    DELETE_COUNT=$(( COUNT - MAX_KEEP ))
    echo "$EXISTING" | head -n "$DELETE_COUNT" | while read -r KEY; do
      echo "[backup] Deleting old backup: $S3_PREFIX/$BACKUP_TYPE/$KEY"
      aws "${AWS_ARGS[@]}" s3 rm "s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_TYPE/$KEY"
    done
  fi
fi

echo "[backup] Done."
