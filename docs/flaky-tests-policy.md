# Flaky tests — quarantine and CI retry policy (QA-001)

This document defines how we identify flaky tests, quarantine them without hiding systemic failures, and how CI applies **bounded** retries so signal stays trustworthy as test volume grows.

---

## 1. Goals

- **Preserve CI signal**: A failing job should mean something is wrong, not “maybe the network blinked.”
- **Time-bound relief**: Quarantine is temporary and owned.
- **Explicit automation**: Retry behavior in GitHub Actions is documented and capped (see `.github/workflows/test.yml`).

---

## 2. Definitions

| Term | Meaning |
|------|---------|
| **Flaky test** | A test that sometimes passes and sometimes fails **without** a deterministic code change (ordering, timing, async races, external services). |
| **Quarantine** | The test is still in tree but is tracked in `.github/flaky-tests-quarantine.json` with **owner**, **expiry**, and **reason**, and is addressed via an approved mitigation (retry in test, `describe.skip` with ticket, etc.). |
| **Bounded retry (CI)** | The workflow retries the **same step** at most **N** times (documented per job). Retries do **not** apply indefinitely. |

---

## 3. Identifying flaky tests

1. **Evidence**: At least two failures on `main`/`develop` or repeated PR flakes where the diff cannot explain the failure (artifacts/logs).
2. **Reproduce**: Prefer reproducing locally or in CI with `--repeat` / stress runs before quarantine.
3. **Ticket**: File or link a GitHub issue for the root cause (performance, missing mock, etc.).

Do **not** use quarantine for genuine product regressions.

---

## 4. Quarantine process

1. Add or update an entry in **`.github/flaky-tests-quarantine.json`** with:
   - **`owner`**: GitHub username responsible for removal or fix.
   - **`expires_on`**: ISO date (`YYYY-MM-DD`) — must be **in the future** when merged.
   - **`scope`**: `frontend` | `backend` | `contracts` | `e2e` | `other`.
   - **`pattern`**: File path or glob identifying the test(s).
   - **`reason`**: Short explanation + issue link if applicable.
   - **`mitigation`**: What we did (e.g. “Jest `retryTimes(1)`”, “skipped pending #nnn”).
2. Open a PR; reviewers confirm expiry is reasonable (typically **≤ 30 days**, extend only with justification).
3. Before **`expires_on`**, either fix and remove the entry, or extend with a new PR updating **`expires_on`** and **`owner`** if ownership changes.

Expired entries must not linger: CI validation fails if **`expires_on`** is in the past.

---

## 5. CI retry policy (bounded)

Central workflow: **`.github/workflows/test.yml`**.

| Job / area | Max attempts | Retry wait (approx.) | Notes |
|------------|--------------|------------------------|--------|
| Frontend unit tests | **2** | 15s | One retry on transient VM/npm issues. |
| Frontend visual (Playwright) | **2** | 20s | Visual runs are most sensitive to timing. |
| Backend Jest | **2** | 15s | One retry for isolation/async flakes. |
| Contracts fast | **2** | 15s | Same bounded pattern. |
| Contracts full (property suites) | **2** | 30s | Property tests can be nondeterministic under load; still capped at 2 attempts total. |

**Total attempts** = initial run + retries = **`max_attempts`** (e.g. 2 means at most two executions of that step). This matches the **`nick-fields/retry@v3`** configuration in `.github/workflows/test.yml` (commands use `cd <dir> && …` so each step runs in the right package).

Retries are **not** applied to lint/typecheck steps — only to **test execution** steps where flakes most often appear.

---

## 6. Registry location

- **Metadata file**: `.github/flaky-tests-quarantine.json`
- **Validation**: `scripts/validate-flaky-quarantine.mjs` (run locally or via CI when the registry changes)

---

## 7. Adoption

- New contributors: read this doc before marking tests skipped or adding retries.
- Code review: challenge quarantines without owner/expiry or with expired dates.

---

## Related

- [`TESTING.md`](../TESTING.md) — overall testing strategy  
- [`migration-rollback-playbook.md`](migration-rollback-playbook.md) — separate policy for DB migrations  
