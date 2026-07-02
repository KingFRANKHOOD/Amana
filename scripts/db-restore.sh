#!/usr/bin/env bash
# db-restore.sh — Download, decrypt, and restore a Postgres backup from S3.
#
# Usage:
#   ./scripts/db-restore.sh [--type daily|weekly|monthly] [--key <s3-object-key>] [--dry-run]
#
# Required env:
#   DATABASE_URL        — PostgreSQL connection string (target DB)
#   GPG_RECIPIENT       — GPG key fingerprint (used to locate private key for decrypt)
#   S3_BUCKET           — S3 bucket name
#
# Optional env:
#   S3_ENDPOINT         — S3-compatible endpoint
#   S3_PREFIX           — key prefix (default: backups)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

BACKUP_TYPE="daily"
SPECIFIC_KEY=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --type=*)   BACKUP_TYPE="${arg#--type=}" ;;
    --key=*)    SPECIFIC_KEY="${arg#--key=}" ;;
    --dry-run)  DRY_RUN=true ;;
  esac
done

if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -o allexport; source "$ROOT_DIR/.env"; set +o allexport
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

S3_PREFIX="${S3_PREFIX:-backups}"

AWS_ARGS=()
if [[ -n "${S3_ENDPOINT:-}" ]]; then
  AWS_ARGS+=(--endpoint-url "$S3_ENDPOINT")
fi

if [[ -n "$SPECIFIC_KEY" ]]; then
  S3_KEY="$SPECIFIC_KEY"
else
  echo "[restore] Fetching latest $BACKUP_TYPE backup key..."
  S3_KEY=$(aws "${AWS_ARGS[@]}" s3 ls "s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_TYPE/" \
      | awk '{print $4}' | sort | tail -n 1)
  if [[ -z "$S3_KEY" ]]; then
    echo "[restore] ERROR: No backups found at s3://$S3_BUCKET/$S3_PREFIX/$BACKUP_TYPE/" >&2
    exit 1
  fi
  S3_KEY="$S3_PREFIX/$BACKUP_TYPE/$S3_KEY"
fi

echo "[restore] Using backup: s3://$S3_BUCKET/$S3_KEY"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[restore] DRY RUN — would restore s3://$S3_BUCKET/$S3_KEY to $DATABASE_URL"
  exit 0
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

ENCRYPTED_FILE="$TMPDIR/backup.sql.gz.gpg"
DUMP_FILE="$TMPDIR/backup.sql.gz"

echo "[restore] Downloading..."
aws "${AWS_ARGS[@]}" s3 cp "s3://$S3_BUCKET/$S3_KEY" "$ENCRYPTED_FILE"

echo "[restore] Decrypting..."
gpg --batch --yes --output "$DUMP_FILE" --decrypt "$ENCRYPTED_FILE"

echo "[restore] Restoring to database..."
gunzip -c "$DUMP_FILE" | psql "$DATABASE_URL"

echo "[restore] Done."
