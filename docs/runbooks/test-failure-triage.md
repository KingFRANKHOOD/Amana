# CI Test-Failure Triage Runbook

How to diagnose failed CI tests, distinguish product regressions from flaky tests and test infrastructure failures, and restore trustworthy CI signal.

This runbook covers the checks in [.github/workflows/ci.yml](../../.github/workflows/ci.yml) for the frontend, backend, mobile, contracts, and frontend/backend Pact jobs. It does not replace the [incident response runbook](./incident-response.md) for production incidents.

## Operating principles

- Treat a failing test as a real failure until evidence shows otherwise.
- Preserve the first failure's logs, commit SHA, job URL, step name, and attempt number before rerunning.
- Use the smallest reproducible test command before changing code or adding retries.
- A retry is a diagnostic or short-lived CI mitigation, not a fix.
- Do not quarantine a deterministic product regression.
- Never include secrets, tokens, or unredacted environment variables in an issue or artifact.

## Severity and ownership

| Level | Use when | Owner and target |
|---|---|---|
| **P1 - Urgent** | `main` or `develop` is blocked, or a release cannot proceed because CI is unavailable or repeatedly failing across stacks | Claim the failure immediately; notify the engineering lead if no progress within 30 minutes |
| **P2 - High** | A PR is blocked by a reproducible failure, or one test is repeatedly flaky across multiple runs | PR author owns the first diagnosis; test owner owns the fix or quarantine |
| **P3 - Normal** | An isolated failure has a clear workaround and does not block a protected branch | File or update an issue during the next working session |

When the failing job could indicate a security, contract, data, or production issue, stop CI triage and follow the relevant incident or rollback procedure.

## First five minutes

1. **Record the failure.** Capture the repository, branch, commit SHA, workflow run URL, job, step, attempt number, test name, and the first meaningful error. Do not rely on a rerun's output.
2. **Check scope.** Compare the failed commit with the last green run. Note whether the failure is limited to one stack, one test, one runner, or all jobs.
3. **Read the whole error.** Separate assertion failures and test timeouts from setup failures such as dependency installation, missing browsers, unavailable services, disk exhaustion, or runner cancellation.
4. **Check recent changes.** Look at the test, implementation, fixtures, migrations, lockfile, workflow, and environment changes touched by the commit.
5. **Rerun once** when the failure looks transient or the log is incomplete. Keep the original attempt and compare both results. Do not repeatedly rerun a deterministic failure to make it disappear.

## Triage decision tree

### A. Test or product failure

Signs include a stable assertion mismatch, a reproducible timeout in the same code path, a type/build error, or a failure that began with the change under test.

1. Reproduce the narrowest test locally using the commands below.
2. Inspect the implementation, fixture, mock, seed data, and test assumptions.
3. Fix the product or test defect and add coverage when the failure exposes a missing case.
4. Do not add a retry or quarantine entry. A retry would hide a regression.

### B. Suspected flaky test

Signs include the same test passing and failing without a relevant code change, order-dependent failures, timing-sensitive failures, leaked state, or a failure that disappears when run alone.

1. Preserve at least two failure examples and the passing run or commit.
2. Run the test repeatedly and in isolation. Vary order or parallelism only after the single-test result is known.
3. Look for shared mutable state, missing cleanup, fixed ports, wall-clock assertions, network dependence, unawaited work, and resource contention.
4. File or update the root-cause issue with the evidence and assign a test owner.
5. Fix the test first. If immediate relief is needed, use the quarantine process below with a bounded mitigation and expiry.

The full policy is in [flaky-tests-policy.md](../flaky-tests-policy.md).

### C. Test infrastructure failure

Signs include dependency download failures, unavailable service containers, runner cancellation, browser installation failures, out-of-memory or disk errors, invalid CI configuration, or failures across unrelated tests and stacks.

1. Preserve the workflow and runner details, including setup-step logs.
2. Check whether another job or a rerun on a fresh runner shows the same failure.
3. Reproduce the setup locally where practical: use the committed lockfile, Node 20, pnpm, and the same package directory as CI.
4. Do not quarantine tests for a runner, dependency mirror, workflow, or service outage.
5. Escalate to the engineering lead or CI owner when the issue affects a protected branch or remains unresolved after the escalation thresholds below.

## Reproduce and isolate locally

Run commands from the repository root unless a working directory is shown. Install with the committed lockfile first:

```bash
cd frontend && pnpm install --frozen-lockfile
cd ../backend && pnpm install --frozen-lockfile
```

Use the narrowest applicable command:

| Area | Single test or focused check | Repeat or isolation check |
|---|---|---|
| Frontend unit | `cd frontend && pnpm test -- --runInBand path/to/test.test.tsx` | `cd frontend && pnpm test -- --runInBand path/to/test.test.tsx --runTestsByPath` |
| Frontend visual | `cd frontend && pnpm test:visual -- tests/visual/path.spec.ts` | Run the same spec twice with one worker: `cd frontend && pnpm test:visual -- tests/visual/path.spec.ts --workers=1 --repeat-each=2` |
| Backend Jest | `cd backend && NODE_ENV=test JWT_SECRET=test-jwt-secret-value-with-minimum-length-32 TRADE_NOTES_ENCRYPTION_KEY=test-trade-notes-encryption-key-base64-32chr pnpm test -- --runInBand path/to/test.test.ts` | Repeat the focused Jest command and compare failures with `--detectOpenHandles` when async cleanup is suspected |
| Mobile | `cd mobile && pnpm test -- path/to/test.test.ts` | Run the focused test twice after clearing test state; also run `pnpm type-check` when the failure is a compile issue |
| Contracts | `cd contracts/amana_escrow && cargo test --locked test_name` | Run the focused test with `cargo test --locked test_name -- --exact --nocapture`, then the full `cargo test --locked` suite |
| Pact | `cd frontend && pnpm test:pact` followed by the backend Pact command with the CI test environment | Compare generated pact artifacts and provider verification output |

Replace placeholder paths and test names with values from the CI log. For Playwright failures, inspect the trace, screenshot, video, and browser-console output when the job provides them.

## Test isolation checklist

Before changing a test's retry or skip behavior, check:

- Does it pass when run alone but fail in the full suite? Reset mocks, timers, databases, files, ports, and global state between tests.
- Does order matter? Run the focused test before and after its neighboring suite.
- Does parallelism matter? Re-run with one worker or Jest `--runInBand`; fixed ports and shared fixtures are common causes.
- Does time matter? Replace real sleeps and wall-clock assumptions with awaited signals, fake timers, or deterministic fixtures.
- Is an external dependency involved? Use a stable mock or local service and verify cleanup after each test.
- Is the failure resource-sensitive? Compare duration, memory, worker count, browser version, and runner logs.
- Is the test itself observing the correct state? Confirm the assertion target, seed data, response status, and generated artifact before changing production code.

Record the isolation result in the issue. A passing isolated run does not prove that the test is flaky; it identifies shared state or concurrency as the next investigation target.

## Quarantine process

Quarantine is temporary relief while the root cause is being fixed. Follow [flaky-tests-policy.md](../flaky-tests-policy.md) for the authoritative rules.

1. Confirm evidence: at least two unexplained failures on `main`/`develop`, or repeated PR flakes, with links to logs and runs.
2. Open or update the root-cause issue and assign one owner.
3. Add an entry to `.github/flaky-tests-quarantine.json` with `owner`, future `expires_on`, `scope`, `pattern`, `reason`, and `mitigation`.
4. Keep the expiry normally within 30 days. Reviewers must reject entries without an owner, expiry, reason, or issue link.
5. Use the smallest bounded mitigation, such as a single test retry or a tracked skip. Do not disable an entire job or suite to hide a failure.
6. In the same PR, describe the removal condition and the validation command for the eventual fix.
7. Before expiry, either fix the test and remove the entry, or submit a new reviewable extension with updated evidence and ownership. Expired entries must not remain.

If the quarantine registry or its validation is missing from the branch, do not invent an untracked skip. Escalate the repository tooling gap and track the proposed entry in the root-cause issue until the registry is restored.

## CI infrastructure checks

Use the failed workflow run as the source of truth and work from the first failing step:

1. **Workflow and permissions:** confirm the run used the expected branch, commit, path filters, workflow revision, and required repository permissions.
2. **Dependency setup:** check Node 20, pnpm version, lockfile integrity, registry availability, cache restore messages, and `pnpm install --frozen-lockfile` output. A lockfile or registry failure is not a test flake.
3. **Service dependencies:** for backend, confirm test environment variables, database/Redis availability, migrations or seed setup, open ports, and teardown logs.
4. **Browser environment:** for Playwright, check browser installation, OS dependencies, viewport configuration, trace collection, and whether the failure reproduces with one worker.
5. **Runner health:** inspect cancellation, timeout, memory, disk, process, and network errors. Compare with other jobs from the same run and with a fresh rerun.
6. **Artifacts:** download coverage, Pact files, screenshots, traces, videos, and logs before the retention window expires. Redact secrets before sharing them.
7. **Workflow changes:** if the failure began after a workflow or action update, review the YAML diff and pin/version changes. Correct the workflow and add a validation check rather than quarantining tests.

## Escalation path

Escalate with the failure summary, run URL, commit SHA, affected stack, reproduction command, attempts, and artifacts:

| Trigger | Escalate to | Action |
|---|---|---|
| `main` or `develop` is blocked for 30 minutes | Engineering lead and CI/workflow owner | Coordinate an unblock; document any temporary mitigation and follow-up issue |
| Two or more unrelated jobs fail from setup, runner, or dependency infrastructure | CI/workflow owner | Treat as an infrastructure incident; preserve logs and avoid test quarantines |
| The same test fails twice without an explained code change | Test owner and PR author | Start the flaky-test evidence and quarantine review process |
| A quarantine is nearing expiry without a fix | Test owner, reviewer, and engineering lead | Fix, remove, or approve a time-bounded extension before expiry |
| Failure suggests a security issue, data loss, contract fund risk, or production impact | On-call and engineering lead | Stop CI-only triage and follow [incident-response.md](./incident-response.md) |

## Resolution and follow-up

CI triage is complete when the failure has a confirmed cause, the affected check passes from a clean run, and the issue records the fix or infrastructure action. For a flaky test, remove the quarantine entry after the fix and run the full affected suite. For an infrastructure failure, link the workflow or platform fix and note whether any rerun or manual approval was required.

For team adoption, review this runbook during onboarding and once per quarter. When a quarantine is opened or extended, the author should walk the reviewer through the evidence, isolation result, owner, expiry, and removal condition.

## Related documents

- [Flaky tests - quarantine and CI retry policy](../flaky-tests-policy.md)
- [Frontend testing infrastructure](../../frontend/TESTING.md)
- [CI workflow](../../.github/workflows/ci.yml)
- [Incident response runbook](./incident-response.md)
- [Rollback procedures](./rollback.md)
