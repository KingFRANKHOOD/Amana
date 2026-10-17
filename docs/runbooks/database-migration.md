# Database Migration Runbook

This is the short, operational version for the moment you're about to run
(or roll back) a migration. For the full policy - backward-compatibility
rules, backup schedule, CI enforcement, and the escalation matrix - see
[migration-rollback-playbook.md](../migration-rollback-playbook.md), which
this page defers to rather than duplicates.

## How to run a migration

Always go through `scripts/migrate-safe.sh`, never `prisma migrate deploy`
directly:

```bash
# See what would happen, without applying anything
./scripts/migrate-safe.sh --env=staging --dry-run

# Staging
./scripts/migrate-safe.sh --env=staging

# Production (adds a backup step + interactive confirmation for destructive DDL)
./scripts/migrate-safe.sh --env=production
```

`migrate-safe.sh` runs, in order: a connectivity check, a list of pending
migrations, a scan of the pending SQL for destructive DDL (`DROP`,
`TRUNCATE`, `NOT NULL` without a `DEFAULT`), a backup (production only,
warns on non-production), the actual `prisma migrate deploy`, and a
post-migration status check. See
[migration-rollback-playbook.md §1](../migration-rollback-playbook.md#1-everyday-migration-workflow)
for the full breakdown of each step.

Before writing a migration that changes an existing column, check
[migration-rollback-playbook.md §2](../migration-rollback-playbook.md#2-backward-compatibility-rules)
for which operations are safe, which need care (add a default before
`NOT NULL`, two-phase a rename), and which are destructive enough to need a
maintenance window.

## How to verify a migration

1. `migrate-safe.sh`'s own post-migration status check (step 6) confirms
   Prisma's migration table is consistent.
2. Hit `GET /health/ready` and `GET /health/detail` on the environment you
   migrated - a broken migration usually shows up as a DB health-check
   failure immediately (see [incident-response.md](./incident-response.md)
   if it doesn't come back healthy).
3. For a schema change that a route depends on, exercise that route once
   in the migrated environment before considering the deploy done (see
   [deployment.md §post-deploy-verification](./deployment.md#post-deploy-verification)).

## How to test migrations in CI

The CI workflow `.github/workflows/migration-rollback.yml` automatically
tests every PR that touches `backend/prisma/` or migration scripts:

1. **Forward migration test** — spins up a real PostgreSQL, applies all
   migrations, and verifies the schema is correct.
2. **Rollback verification** — inserts test data, then verifies rollback
   and data integrity after rollback.
3. **Destructive DDL scan** — scans migration SQL for DROP, TRUNCATE, and
   unsafe NOT NULL patterns and warns on PR annotations.
4. **Dry-run verification** — confirms `migrate-safe.sh --dry-run` never
   modifies the database schema.
5. **Rollback SQL validation** — checks that existing `rollback.sql` files
   are non-empty and syntactically valid.

All five checks must pass for the migration safety gate to succeed.

### Running tests locally

```bash
# Full integration test (requires PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/amana_test \
  ./scripts/test-migration-rollback.sh

# Jest-based unit tests (no database needed)
cd backend && npx jest --testPathPattern="migration-rollback" --no-coverage
```

## How to roll back a migration

Read [migration-rollback-playbook.md §4 Rollback Procedures](../migration-rollback-playbook.md#4-rollback-procedures)
for the full detail on each scenario below before acting - which one applies
depends on how far the migration got and whether it's already in
production:

1. **Scenario A - migration failed mid-run.** Prisma rolls back the failed
   transaction automatically, leaving it "failed" in `_prisma_migrations`.
   Inspect with `npx prisma migrate status`, fix the SQL and re-run
   `migrate-safe.sh`, or mark it rolled back without reapplying via
   `./scripts/migrate-rollback.sh --env=<env> --mark-rolled-back=<migration_name>`.
2. **Scenario B - migration succeeded but broke the application.** Apply
   the migration's companion `rollback.sql` (if one exists) via
   `./scripts/migrate-rollback.sh --env=<env> --from-sql=backend/prisma/migrations/<name>/rollback.sql`.
   For production, coordinate with on-call first - this modifies the live
   schema.
3. **Scenario C - catastrophic failure, restore from backup.**
   `./scripts/migrate-rollback.sh --env=production --from-backup=<backup file>`.
   This drops and recreates the database - all rows written after the
   backup point are lost. Last resort only, and requires the escalation in
   [migration-rollback-playbook.md §8](../migration-rollback-playbook.md#8-contacts-and-escalation)
   - page on-call, do not run further migrations until resolved.

After any of the above: confirm the application is healthy (see
[deployment.md §post-deploy-verification](./deployment.md#post-deploy-verification)),
mark the migration rolled back if you haven't already, and file a
postmortem per [incident-response.md](./incident-response.md) if this was
production.

## Backups

| Environment | When | How | Retention |
|---|---|---|---|
| Staging | Before every migration | `pg_dump` via `migrate-safe.sh` | 7 days |
| Production | Before every migration + daily | Managed cloud backup + `pg_dump` | 30 days |

See [migration-rollback-playbook.md §6 Backup Strategy](../migration-rollback-playbook.md#6-backup-strategy)
for where backups are stored and how to restore one.

## CI enforcement

[migration-rollback-playbook.md §7 CI Migration Check](../migration-rollback-playbook.md#7-ci-migration-check)
documents the `.github/workflows/migration-rollback.yml` workflow that runs
five parallel jobs on every PR:

- **Migration Rollback Test**: full forward + backward migration with data
  integrity verification on a real PostgreSQL instance
- **Destructive DDL Scan**: static analysis of migration SQL files
- **Migration Unit Tests**: Jest tests for migration file hygiene
- **Migration Dry-Run**: verifies `migrate-safe.sh --dry-run` is safe
- **Rollback SQL Validation**: validates existing rollback SQL files

The **Migration Safety Gate** requires all five to pass before merge to
`main`. PRs with risky DDL receive CI warning annotations with remediation
steps. For PRs targeting `main`, risky DDL fails the safety gate unless the
PR has the `migration:destructive-approved` label.

Apply the label only after explicit DBA/on-call review, a tested
`rollback.sql`, and a planned maintenance window.
