## Summary

This PR closes four **Stellar Wave** backlog items in one branch: CI merge gates, backend test standardization, migration safety scanning, and flaky-test governance.

## Motivation

- **Visual regression tests** must block merges when they fail.
- **Mixed Jest/Vitest** in the backend increases flake surface and maintenance cost.
- **Migration scans** need to catch more classes of risky DDL before production.
- **Flaky tests** need a documented quarantine model and **bounded** CI retries so signal stays trustworthy as suites grow.

## Changes

### #467 — CI-002: Frontend visual tests in the required status gate

- Updated `.github/workflows/test.yml` so the `all-tests-pass` job depends on **`frontend-visual`** as well as frontend/unit, backend, and contracts jobs.
- Visual failures therefore fail the same aggregate gate as other test layers; Playwright artifact upload behavior is unchanged (`continue-on-error` only where upload aids debugging).

### #469 — TEST-001: Standardize backend tests on Jest

- Canonical runner remains **`jest`** (`backend/package.json` → `npm run test`).
- Removed **`vitest`** from backend dependencies and deleted **`backend/vitest.config.ts`**.
- Migrated Vitest-based suites (imports, mocks, `vi` → `jest`, RPC factory hooks where needed) to Jest-compatible patterns across affected `backend/src/**/__tests__` files.

### #472 — DB-002: Strengthen destructive migration scanner

- Expanded grep-style patterns in **`.github/workflows/migration-check.yml`** (e.g. additional `DROP *`, constraint drops, renames, type changes).
- Broadened **`backend/src/__tests__/migration-safety.test.ts`** coverage; fixed migration path resolution relative to `backend/prisma/`.
- **`docs/migration-rollback-playbook.md`**: documented approval behavior for risky DDL (e.g. `migration:destructive-approved` for PRs targeting `main`, aligned with existing workflow behavior).

### #480 — QA-001: Flaky-test quarantine and bounded retries

- **`docs/flaky-tests-policy.md`**: identification process, quarantine rules, owner/expiry expectations, and mapping to CI retry caps.
- **`.github/flaky-tests-quarantine.json`**: machine-readable registry (currently empty `entries`; each future entry requires **`owner`**, **`expires_on`**, and related fields per policy).
- **`scripts/validate-flaky-quarantine.mjs`**: validates registry shape and that **`expires_on`** is not in the past.
- New CI job **`flaky-registry`** runs the validator; **`all-tests-pass`** requires it.
- Test execution steps in **`.github/workflows/test.yml`** wrap **`npm`** / **`cargo test`** with **`nick-fields/retry@v3`**, **`max_attempts: 2`** (bounded), per stack.

### Docs / adoption

- **`TESTING.md`**: links to flaky policy, registry, and validator.

## How to verify

1. **Workflow YAML**: Confirm `test.yml` parses (GitHub Actions editor or `act` if you use it).
2. **Backend**: `cd backend && npm ci && npm test`
3. **Registry validator**: `node scripts/validate-flaky-quarantine.mjs`
4. **Optional**: Run targeted suites touched by Jest migration (e.g. `abi.compatibility`, `migration-safety`, `eventListener.idempotency`).

## Breaking changes

None intended. Public API contracts are unchanged.

## Related issues

Closes KingFRANKHOOD/Amana#467  
Closes KingFRANKHOOD/Amana#469  
Closes KingFRANKHOOD/Amana#472  
Closes KingFRANKHOOD/Amana#480

## Checklist

- [x] Documentation updated where required (migration playbook, flaky policy, TESTING)
- [x] CI workflow updated for gates and bounded retries
- [ ] Maintainer review of branch protection / required checks (ensure `CI Test Suite` / `All Tests Pass` match org expectations)
