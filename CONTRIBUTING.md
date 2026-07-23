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
- **Docker & Docker Compose**: v2.20+
- **Rust & Soroban CLI** (for contract development): `soroban-cli` v21+

### Repository Setup
1. Fork the repository on GitHub and clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Amana.git
   cd Amana
   ```
2. Install root and workspace dependencies:
   ```bash
   npm install
   cd backend && npm install
   cd ../frontend && npm install
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
  cd backend
  npm test
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

## Pull Request Process

1. **Verify Local Build & Tests**: Ensure all linting checks and test suites pass locally before pushing.
2. **Submit PR**: Open a Pull Request targeting `main`. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) completely.
3. **Link Issue**: Ensure the PR body references the relevant issue (e.g., `Closes #123`).
4. **Code Review**: At least one maintainer review is required before merging. Address review feedback promptly in follow-up commits.
5. **Clean Merges**: PRs will be squashed or rebased onto `main` to preserve a clean commit log.
