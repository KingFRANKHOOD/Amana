# Contributing to Amana

First off, thank you for considering contributing to Amana! It's contributions like yours that make Amana a secure, reliable, and performant financial escrow ecosystem.

Please review the guidelines below before opening a pull request or submitting an issue.

---

## Code of Conduct

We expect all contributors to adhere to a professional, respectful, and collaborative code of conduct. Maintain constructive feedback during reviews and prioritize code quality, security, and developer ergonomics.

---

## Getting Started

### Prerequisites
- **Node.js**: v20+
- **pnpm**: v10.33.0, activated through Corepack
- **Docker & Docker Compose**: v2.20+
- **Rust & Soroban CLI** (for contract development): `soroban-cli` v21+

Enable Corepack and activate the repository's pinned pnpm version before
installing dependencies:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm --version
```

The root `packageManager` field pins the exact pnpm release. Do not use npm or
generate additional `package-lock.json` files; the install guard rejects
non-pnpm root installs.

### Repository Setup
1. Fork the repository on GitHub and clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Amana.git
   cd Amana
   ```
2. Install root and workspace dependencies:
   ```bash
   pnpm install
   pnpm --dir backend install
   pnpm --dir frontend install
   ```
3. Copy environment configurations:
   ```bash
   cp backend/.env.example backend/.env
   cp .env.staging.example .env.staging
   ```
4. Start local development infrastructure:
   ```bash
   ./scripts/dev-up.sh
   ```

---

## Monorepo Commands

Run package commands from the repository root with `pnpm --dir`. This keeps
your working directory stable and uses the lockfile owned by each package.

| Task | Command |
|---|---|
| Start the backend | `pnpm --dir backend dev` |
| Start the frontend | `pnpm --dir frontend dev` |
| Test the backend | `pnpm --dir backend test` |
| Test the frontend | `pnpm --dir frontend test` |
| Lint the backend | `pnpm --dir backend lint` |
| Lint the frontend | `pnpm --dir frontend lint` |
| Build the backend | `pnpm --dir backend build` |
| Build the frontend | `pnpm --dir frontend build` |
| Start the mobile app | `pnpm --dir mobile start` |
| Test the routes service | `pnpm --dir routes-d test` |

To pass additional arguments to a package script, insert `--` before them. For
example, run one frontend test with
`pnpm --dir frontend test -- --runInBand path/to/test.ts`.

---

## Development Workflow & Standards

### Branch Naming Conventions
Use descriptive branch names prefixed with the appropriate category:
- `feat/short-description` — New features
- `fix/short-description` — Bug fixes
- `docs/short-description` — Documentation improvements
- `refactor/short-description` — Code improvements without functional changes
- `infra/short-description` — Docker, CI/CD, and build setup

*Example:* `fix/issue-859-gitignore` or `feat/soroban-event-retry`

### Commit Message Guidelines
We follow the **Conventional Commits** specification:
```text
<type>(<scope>): <short description>

<optional extended description>

Closes #<issue-number>
```

#### Allowed Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting, missing semi-colons, etc. (no code logic change)
- `refactor`: Refactoring production code (e.g. renaming a variable)
- `test`: Adding missing tests or refactoring existing tests
- `infra` / `chore`: Maintenance, dependencies, or configuration updates

#### Commit Rules:
- Keep the title line under 72 characters.
- Use the imperative present tense ("add feature" not "added feature").
- Do **NOT** append AI co-pilot disclaimers, signatures, or automated emojis to commit messages.

---

## Coding Standards

### TypeScript / Backend
- Strict type checking enabled (`strict: true` in `tsconfig.json`). Avoid using `any` — prefer strict Zod schemas or explicit interface types.
- Ensure all environment variables are validated through `src/config/env.ts`.
- Retain existing code comments, docstrings, and architectural descriptions.

### Soroban / Contracts
- All smart contracts must maintain deterministic error codes and strict authorization checks (`require_auth()`).
- Document all events emitted by contract invocations.

### Frontend
- Components should remain modular and responsive.
- Do not commit inline dynamic key credentials or unhandled promise rejections.

---

## Testing Expectations

All contributions must include test coverage verifying the new behavior or bug fix.

### Running Tests
- **Backend unit & integration tests:**
  ```bash
  pnpm --dir backend test
  ```
- **Staging environment validation:**
  ```bash
  ./scripts/staging-up.sh
  ```
- **Contract deployment safety check:**
  ```bash
  ./scripts/check-contract-deployment-safety.sh
  ```

---

## Bounties & Contributor Payments

Amana runs its contributor bounties through the GitHub issue tracker. Each
bounty issue states the reward and the payout asset up front, and payouts are
settled on-chain to the contributor's Stellar address once the linked pull
request is reviewed and merged.

### Where to find payment proof

We do not publish a separate list of transaction hashes in this document,
because every payout is already publicly verifiable on-chain and traceable
from the issue that funded it:

1. Open the bounty issue you are interested in and read its payout details.
2. Follow the linked pull request and its merge commit to confirm the work was
   accepted.
3. Look up the payout transaction on a Stellar block explorer (for example
   [stellar.expert](https://stellar.expert)) using the transaction hash or the
   recipient address referenced in the issue or PR discussion.

If a specific bounty's payout history is unclear, ask directly on that issue
and a maintainer will point you to the corresponding transaction. Please do
not treat any hash, address, or link you cannot independently verify on-chain
as proof of payment.

---

## Pull Request Process

1. **Verify Local Build & Tests**: Ensure all linting checks and test suites pass locally before pushing.
2. **Submit PR**: Open a Pull Request targeting `main`. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) completely.
3. **Link Issue**: Ensure the PR body references the relevant issue (e.g., `Closes #123`).
4. **Code Review**: At least one maintainer review is required before merging. Address review feedback promptly in follow-up commits.
5. **Clean Merges**: PRs will be squashed or rebased onto `main` to preserve a clean commit log.
