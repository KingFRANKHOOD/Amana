# Branch Protection Policy

> Closes #479 (SEC-001)

## Protected Branches

| Branch    | Protection Level |
|-----------|-----------------|
| `main`    | Required checks + no direct push |
| `develop` | Required checks + no direct push |

## Required Status Checks

All of the following checks **must pass** before a PR can be merged into `main` or `develop`.
None of these checks use `continue-on-error`; a failure blocks the merge.

| Check Name                  | Workflow File          | Stack      | What It Validates                                      |
|-----------------------------|------------------------|------------|--------------------------------------------------------|
| `Frontend Required Gate`    | `.github/workflows/ci.yml` | `frontend/` | `npm ci`, `npm run lint`, `npm run build`          |
| `Backend Required Gate`     | `.github/workflows/ci.yml` | `backend/`  | `npm ci`, `npm run build`, representative smoke suite (auth, trade, events, validation) |
| `Contracts Required Gate`   | `.github/workflows/ci.yml` | `contracts/` | `cargo test`                                      |

Path-aware skipping is enabled via `dorny/paths-filter`. When a stack has no changed files the
gate emits a skip note and exits 0, so branch protection is satisfied without running unnecessary
work.

## Repository Settings (GitHub)

Navigate to **Settings → Branches → Branch protection rules** and configure the following for
both `main` and `develop`:

- [x] **Require a pull request before merging**
  - [x] Require approvals: 1 (minimum)
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required checks (add each by exact name):
    - `Frontend Required Gate`
    - `Backend Required Gate`
    - `Contracts Required Gate`
- [x] **Do not allow bypassing the above settings** (applies to admins too)

## What Is Explicitly Prohibited

- `continue-on-error: true` on any step that is part of a required gate.
- Merging directly to `main` or `develop` without a PR.
- Skipping required checks via `[skip ci]` commit messages on protected branches.

## Periodic Verification Checklist

Run this checklist after any change to `.github/workflows/ci.yml` or repository settings:

1. Open **Settings → Branches** and confirm the three required checks are listed under each
   protected branch rule.
2. Grep the workflow file for `continue-on-error` — the result must be empty for required gate
   jobs:
   ```sh
   grep -n 'continue-on-error' .github/workflows/ci.yml
   # Expected: no output (or only lines inside non-required jobs)
   ```
3. Open a draft PR that intentionally breaks a lint rule and confirm the `Frontend Required Gate`
   check fails and the merge button is blocked.
4. Confirm the `Backend Required Gate` runs the full smoke suite (auth, trade, events,
   validation) by inspecting the CI log for the expected test file names.
5. Record the date of verification and the GitHub username of the reviewer in the table below.

## Verification Log

| Date       | Verified By | Notes                        |
|------------|-------------|------------------------------|
| 2026-04-27 | devJaja     | Initial policy establishment |
