# ADR-008: CI/CD Pipeline Architecture

## Status

Accepted

*(Implemented in `.github/workflows/ci.yml`, `.github/workflows/security-audit.yml`, `.github/workflows/staging.yml`, `.github/workflows/codeql.yml`, `.github/workflows/secrets-scan.yml`)*

## Context

Amana is a monorepo containing four distinct stacks — `frontend` (Next.js), `backend` (Node.js/TypeScript), `mobile` (React Native/Expo), and `contracts` (Rust/Soroban). Each stack has its own language runtime, build toolchain, test runner, and security profile. Without a documented rationale, CI/CD changes risk introducing inconsistency, bypassing critical quality gates, or silently skipping checks when only some stacks change.

Several problems motivated formalizing this ADR:

- Contributors modifying one stack had no clear signal about which CI jobs were required for their change.
- GitHub Actions configurations accumulated ad-hoc changes without a shared understanding of why specific tools or thresholds were chosen.
- Knowledge of coverage thresholds, security scanning decisions, and gate sequencing was concentrated in the original authors and not discoverable from the repository.
- Future maintainers extending the pipeline (e.g., adding Docker image builds, a new stack, or tighter SAST rules) had no baseline to reason against.

## Decision

### 1. Path-aware stack detection eliminates unnecessary CI runtime

The `changes` job at the start of `ci.yml` uses `dorny/paths-filter` to detect which stacks have changed files. Downstream jobs conditionally execute only if their stack has changed. This means a documentation-only change does not trigger a full Rust build, and a frontend change does not run `cargo test`.

**Rationale:** The four stacks have very different cold-start times (Rust WASM builds are expensive; Node installs are fast). Running every stack on every push would waste runner minutes and slow down PR feedback. Path-aware execution maintains the feedback signal without the waste.

**Trade-off:** A change that touches shared configuration (e.g., `docker-compose.yml`) does not automatically trigger all stacks. CI coverage of cross-stack interactions depends on the E2E job rather than the per-stack gates.

### 2. Each stack runs its own dedicated quality gate

Per-stack jobs in the matrix (`frontend`, `backend`, `mobile`, `contracts`) run in parallel. Each gate runs the minimum checks required for that stack:

| Stack | Required checks |
|---|---|
| Frontend | `pnpm install --frozen-lockfile` → `npm audit` → build → lint → unit tests with coverage → visual regression (Playwright) |
| Backend | `pnpm install --frozen-lockfile` → `npm audit` → build → lint → unit tests with coverage |
| Mobile | `pnpm install --frozen-lockfile` → `pnpm audit` → type-check → lint → unit tests with coverage |
| Contracts | Rust toolchain setup → `cargo audit` → deployment safety checks → `cargo test --locked` → WASM build → WASM ABI hash |

**Rationale:** Failing fast at the stack level isolates the root cause. A broken Rust build does not mask a frontend lint failure. Keeping gates stack-scoped also makes branch protection rules straightforward: each required status check maps to one named job.

### 3. Frozen lockfiles are required for all install steps

All `pnpm install` steps use `--frozen-lockfile`. The Rust gate uses `cargo test --locked`.

**Rationale:** Unfrozen installs allow dependency drift between local development and CI, which can introduce undiscovered breakage when a transitive dependency ships a patch. Locking ensures reproducibility and avoids "works on my machine" failures.

### 4. Security scanning is layered across multiple tools

The pipeline uses four complementary scanning layers:

- **`npm audit` / `pnpm audit` (per-stack, per-PR):** Catches known CVEs in direct and transitive Node.js dependencies at the `high` severity threshold. Runs inside every frontend and backend stack gate on every PR.
- **`cargo audit` (per-PR and weekly):** Audits Rust dependency crates against the RustSec advisory database. Runs inside the contracts gate and in the weekly `security-audit.yml` workflow.
- **Trivy filesystem scan (per-PR and weekly):** Scans the dependency manifests and lockfiles of each stack for HIGH/CRITICAL vulnerabilities. Results are uploaded to the GitHub Security tab as SARIF reports. Runs in both `ci.yml` and `security-audit.yml`.
- **CodeQL (scheduled and on push):** Static analysis for code-level security issues across applicable languages.
- **Gitleaks secrets scan:** Scans for accidentally committed secrets and credentials.
- **GitHub dependency review (weekly PRs to `main`/`develop`):** Reviews dependency changes introduced in a PR and fails on HIGH/CRITICAL additions.

**Rationale:** No single tool covers all risk categories. `npm audit` and `cargo audit` are fast and catch dependency CVEs early in the feedback loop. Trivy catches vulnerability classes that package audits miss (OS-level packages, container layers once images are added). CodeQL catches logic-level issues that dependency scanners cannot see. Weekly sweeps catch advisories published after the last PR merged.

**Coverage threshold:** The pipeline does not enforce a minimum coverage percentage at the CI level. Coverage reports are uploaded to Codecov for visibility and trend tracking. A failing Codecov report sends a notification but does not block merge. This was a deliberate choice to avoid blocking legitimate PRs during early-stage development while still surfacing coverage regression trends.

### 5. Contract-specific gate includes deployment safety checks and ABI hash

The contracts gate runs `scripts/check-contract-deployment-safety.sh` before tests and verifies a SHA-256 hash of the compiled WASM artifact at the end.

**Rationale:** Soroban contracts are deployed on-chain; a broken deployment cannot be easily rolled back. The deployment safety script validates invariants that `cargo test` does not cover (e.g., contract size limits, ABI stability markers). The ABI hash is logged and stored as a CI artifact so reviewers can confirm that the compiled WASM matches the source change.

### 6. E2E tests run against a seeded staging stack, not mocks

The `e2e` job in `ci.yml` spins up a full `docker compose` staging environment using `scripts/staging-up.sh`, runs `prisma migrate deploy` against a local Postgres instance, seeds test data, starts the real backend and frontend processes, and then runs Playwright tests against them.

**Rationale:** Mocked integration tests cannot detect contract violations between the frontend, backend, and database. The seeded staging environment uses the same migrations and schemas as production, so E2E failures are meaningful signals rather than test artifacts. The environment is torn down after every run to avoid state leakage between jobs.

**Trade-off:** The E2E job is the slowest gate (~3–5 minutes) and has higher flakiness risk than unit tests. The `docs/flaky-tests-policy.md` defines the quarantine and triage process for flaky E2E tests.

### 7. Pact contract tests enforce the frontend ↔ backend API boundary

The `contract-tests` job generates Pact consumer contracts from the frontend and verifies them against the backend provider. This runs whenever either the frontend or backend changes.

**Rationale:** API schema drift between the frontend and backend is a common source of runtime failures that are difficult to catch with unit tests alone. Pact tests pin the expected request/response shapes and fail immediately if either side diverges. This is faster and cheaper to run than a full E2E suite for each API change.

### 8. Pinned action versions prevent supply-chain attacks

Every third-party GitHub Action used in the pipeline is pinned to either a full commit SHA or a patch version tag (e.g., `dorny/paths-filter@6852f92c20ea7fd3b0c25de3b5112db3a98da050`, `aquasecurity/trivy-action@0.28.0`). First-party GitHub Actions (`actions/checkout`, `actions/setup-node`, etc.) are pinned to major version tags.

**Rationale:** Floating tags like `@main` or `@latest` allow a malicious actor who compromises a third-party action repository to inject code into CI runs. Pinning to SHAs eliminates that risk for the highest-impact external dependencies.

### 9. Staging deploy is a separate, gated workflow

The `staging.yml` workflow deploys to the staging environment only on pushes to `develop` or when files under `backend/**`, `docker-compose.yml`, or the staging scripts change. It is not triggered by every PR.

**Rationale:** Staging is a shared environment. Running staging deploys on every branch PR would cause deploy collisions and contaminate shared test data. Restricting deploys to `develop` merges ensures staging is always a clean, reviewed baseline.

### 10. Review process for CI/CD changes

Changes to any workflow file under `.github/workflows/` require at minimum one reviewer with write access to the repository. The `ci.yml` file is listed in `.github/CODEOWNERS` (or should be — see follow-up below) so that changes automatically request a review from the platform team.

**Rationale:** CI/CD configuration is a privileged surface: a malicious or accidental change could disable required checks, exfiltrate secrets, or introduce untested deployments. Mandatory review gives a second pair of eyes on every pipeline change.

## Consequences

- **Positive:** Future contributors can understand the rationale behind every CI gate, tool, and threshold from this document. CI changes can be made and reviewed with a shared baseline.
- **Positive:** Path-aware execution reduces average CI runtime and runner cost. Only the stacks that changed are tested.
- **Positive:** Layered security scanning provides defense-in-depth without any single tool becoming a single point of failure.
- **Negative:** The pipeline has a non-trivial number of jobs and tools. New contributors must read this ADR and `ci.yml` to understand the full picture. Complexity is a maintenance cost.
- **Negative:** Pinning third-party actions to SHAs requires manual updates to stay current with upstream security patches. A Dependabot configuration or periodic rotation schedule is required to keep pins fresh.
- **Negative:** Not enforcing a minimum coverage percentage in CI means that coverage can decline silently unless Codecov alerts are acted on promptly.
- **Follow-up:** Add a `CODEOWNERS` entry for `.github/workflows/` files to ensure pipeline changes are always reviewed by the platform team.
- **Follow-up:** Once Docker images are built for the backend and frontend, switch Trivy scans from `fs` mode to `image` mode to cover OS-level vulnerabilities in the base image layer.
- **Follow-up:** Evaluate adding a minimum coverage gate (e.g., fail if coverage drops by more than 5% in a PR) once overall coverage reaches a stable baseline.
