# Database Migration Safety & Rollback Playbook

This document covers how to safely apply Prisma migrations, detect destructive changes, and roll back when something goes wrong.

---

## 1. Everyday Migration Workflow

Always use `scripts/migrate-safe.sh` instead of running `prisma migrate deploy` directly. It adds pre-flight checks, a backward-compatibility scan, and an optional backup step.

```bash
# Staging
./scripts/migrate-safe.sh --env=staging

# Production (with backup + interactive confirm for destructive DDL)
./scripts/migrate-safe.sh --env=production

# Dry run — report what would happen without making changes
./scripts/migrate-safe.sh --env=staging --dry-run
```

### What the script checks

| Step | Check |
|------|-------|
| 1 | Database connectivity |
| 2 | List pending migrations (dry status) |
| 3 | Scan pending SQL for destructive DDL (`DROP`, `TRUNCATE`, `NOT NULL` without `DEFAULT`) |
| 4 | Create a `pg_dump` backup (production) or warn (non-production) |
| 5 | `prisma migrate deploy` |
| 6 | Post-migration status verification |

---

## 2. Backward-Compatibility Rules

### Safe operations (no rollout risk)
- Adding a nullable column
- Adding a new table
- Adding an index (`CREATE INDEX CONCURRENTLY` preferred in prod)
- Widening a `VARCHAR` limit

### Requires care
| Operation | Risk | Mitigation |
|-----------|------|-----------|
| `NOT NULL` column without default | Fails for existing rows | Add a `DEFAULT` or backfill first |
| Renaming a column | Breaks code that references old name | Use a two-phase deploy: add new column, migrate data, remove old column |
| Changing a column type | Data loss / cast errors | Use `USING` expression; test with production data volume |
| Adding a `UNIQUE` constraint | Fails if duplicates exist | Deduplicate data first in a separate migration |

### Destructive (requires maintenance window + rollback plan)
| Operation | Mitigation |
|-----------|-----------|
| `DROP COLUMN` | Ensure no code references column; deploy code first |
| `DROP TABLE` | Ensure no foreign key references; archive data if needed |
| `TRUNCATE` | Only in emergency data cleanup; always backup first |

---

## 3. Writing a Rollback SQL File

Prisma does not support automatic down-migrations. For each migration that is not trivially reversible, create a companion `rollback.sql` in the same migration directory:

```
backend/prisma/migrations/
  20260424000001_add_foo_column/
    migration.sql      ← prisma-generated, applies the change
    rollback.sql       ← hand-written, undoes the change
```

**Example:**

`migration.sql` (generated):
```sql
ALTER TABLE "Trade" ADD COLUMN "fooBar" TEXT;
```

`rollback.sql` (hand-written):
```sql
ALTER TABLE "Trade" DROP COLUMN IF EXISTS "fooBar";
```

Keep rollback SQL minimal and tested. Run it against a staging clone before recording the playbook.

---

## 4. Rollback Procedures

### Scenario A — Migration failed mid-run

Prisma wraps each migration in a transaction. If the migration fails, the transaction is rolled back automatically. The migration is left in a "failed" state in `_prisma_migrations`.

```bash
# Inspect state
DATABASE_URL=<url> npx prisma migrate status

# If safe to retry after fixing the SQL:
./scripts/migrate-safe.sh --env=staging

# If you need to mark it as rolled back without reapplying:
./scripts/migrate-rollback.sh --env=staging --mark-rolled-back=<migration_name>
```

### Scenario B — Migration succeeded but broke the application

Use the companion `rollback.sql` if one exists:

```bash
./scripts/migrate-rollback.sh --env=staging \
  --from-sql=backend/prisma/migrations/<name>/rollback.sql
```

For production, coordinate with on-call before running. This modifies the live schema.

### Scenario C — Catastrophic failure (restore from backup)

```bash
./scripts/migrate-rollback.sh --env=production \
  --from-backup=backups/pre-migration-20260424-120000.sql.gz
```

> **Warning:** This drops and recreates the database. All rows inserted after the backup point will be lost. Only use this as a last resort.

After restoring:
1. Confirm application is healthy.
2. Mark the failed migration as rolled back: `./scripts/migrate-rollback.sh --mark-rolled-back=<name>`.
3. File a post-mortem.

---

## 5. Pre-production Checklist

Before applying any migration to production:

- [ ] Migration applied and validated on staging (`./scripts/migrate-safe.sh --env=staging`)
- [ ] Staging validation passes (`./scripts/staging-validate.sh`)
- [ ] Rollback SQL written and tested on staging
- [ ] Pre-migration backup taken (`backups/` directory)
- [ ] No destructive DDL without maintenance window scheduled
- [ ] Application code deployed / feature-flagged to tolerate both old and new schema (if blue-green)
- [ ] On-call engineer notified
- [ ] Post-migration smoke test plan ready

---

## 6. Backup Strategy

| Environment | When | Tool | Retention |
|-------------|------|------|-----------|
| Staging | Before every migration | `pg_dump` via `migrate-safe.sh` | 7 days |
| Production | Before every migration + daily | Managed cloud backup + `pg_dump` | 30 days |

Backups are stored in `backups/` locally (staging) and in encrypted cloud storage (production). The `backups/` directory is in `.gitignore`.

---

## 7. CI Migration Check

The CI workflow `.github/workflows/migration-check.yml` runs on every PR that touches `backend/prisma/`:

- Lists the migration diff versus `main`
- Scans new migration SQL for destructive DDL and emits warnings as PR annotations
- Verifies `migration_lock.toml` is up to date

Failures block merge for production branches (`main`).

---

## 8. Contacts and Escalation

| Situation | Action |
|-----------|--------|
| Failed migration on staging | Fix SQL, re-run `migrate-safe.sh`, or rollback |
| Failed migration on production | Page on-call immediately; execute Scenario B or C above |
| Data loss suspected | Stop writes; page on-call; do NOT run any more migrations |
