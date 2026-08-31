# Contributor Onboarding Guide

Welcome to the Amana project! This guide will help you get started with the codebase, set up your development environment, and understand the recommended workflows for contributions.

## Quick Start (5 minutes)

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR-USERNAME/Amana.git
   cd Amana
   ```

2. **Install Dependencies**
   ```bash
   npm install
   cd backend && npm install && cd ..
   cd frontend && npm install && cd ..
   ```

3. **Set Up Environment**
   ```bash
   cp .env.staging.example .env.staging
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

4. **Start Development Server**
   ```bash
   ./scripts/dev-up.sh
   ```

5. **Start Coding** ✅

For detailed setup instructions per stack, continue reading.

---

## Repository Structure

### Top-Level Directories

```
Amana/
├── backend/           # Node.js/TypeScript API (Express)
├── frontend/          # Next.js web application
├── mobile/            # React Native Expo app
├── contracts/         # Soroban smart contracts (Rust)
├── routes-d/          # Standalone Stellar route-building service (Express)
├── docs/              # Project documentation (you are here)
├── infra/             # Docker and deployment configs
├── k6/                # Performance testing scripts
├── scripts/           # Utility scripts (dev, build, test, deploy)
├── .github/           # GitHub Actions workflows and templates
└── README.md          # Project overview
```

### Key Documentation Files

| File | Purpose |
|------|---------|
| [README.md](../README.md) | Project overview and quick start |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines and conventions |
| [DISTRIBUTED_TRACING_GUIDE.md](./DISTRIBUTED_TRACING_GUIDE.md) | OpenTelemetry and observability setup |
| [PROMETHEUS_METRICS.md](./PROMETHEUS_METRICS.md) | Application metrics and monitoring |
| [architecture.md](./architecture.md) | System design and component interactions |
| [sequence-diagrams.md](./sequence-diagrams.md) | Trade lifecycle and workflow sequences |
| [routes-d/README.md](../routes-d/README.md) | Route-building service purpose, API, and usage |

---

## Local Development Setup

### Prerequisites

Ensure you have these installed:

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v20+ | JavaScript runtime |
| Docker | v25+ | Containerized services |
| Docker Compose | v2.20+ | Multi-container orchestration |
| Rust | latest (stable) | Smart contract development |
| Cargo | latest | Rust package manager |

### System Setup

#### macOS
```bash
# Using Homebrew
brew install node@20 docker docker-compose rust

# Or manually download from:
# - Node: https://nodejs.org/
# - Docker Desktop: https://www.docker.com/products/docker-desktop
# - Rust: https://www.rust-lang.org/tools/install
```

#### Linux (Ubuntu/Debian)
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Windows
- Download Node.js installer from https://nodejs.org/
- Install Docker Desktop for Windows
- Install Rust from https://www.rust-lang.org/tools/install

### Stack-Specific Setup

#### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Run migrations
npx prisma migrate dev

# Start development server
npm run dev

# Server runs on http://localhost:4000
```

**Environment Variables** (backend/.env):
- `PORT`: Server port (default: 4000)
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT signing
- `SUPABASE_URL`: Supabase project URL
- `PINATA_JWT`: Pinata IPFS authentication token
- `STELLAR_NETWORK`: Network to use (testnet/public)

See [backend/.env.example](../backend/.env.example) for all variables.

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Start development server
npm run dev

# App runs on http://localhost:3000
```

**Environment Variables** (frontend/.env.local):
- `NEXT_PUBLIC_API_BASE_URL`: Backend API URL
- `NEXT_PUBLIC_STELLAR_NETWORK`: Stellar network (testnet/public)
- `NEXT_PUBLIC_WALLET_PROVIDER`: Wallet connection (freighter/albedo)

See [frontend/.env.example](../frontend/.env.example) for all variables.

#### Mobile Setup

```bash
cd mobile

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Start Expo dev server
npm start

# Scan QR code with Expo Go app
```

#### Contracts Setup

```bash
cd contracts/amana_escrow

# Build WebAssembly artifact
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test --locked

# Build and verify
cargo build --features wasm --release
```

#### routes-d Setup

```bash
cd routes-d

# Install dependencies
npm install

# Run tests (Vitest, 80% coverage threshold)
npm test

# Type-check / lint
npm run lint
```

**Configuration** (`routes-d`):
- `STELLAR_NETWORK`: Stellar network to use (`testnet` default, or `mainnet`).
  Selects the Horizon endpoint and network passphrase.

See [routes-d/README.md](../routes-d/README.md) for the full API surface and
usage.

### Docker Compose Services

Start all services with:

```bash
./scripts/dev-up.sh
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Supabase (port 54321)
- Jaeger (port 16686) — distributed tracing
- Prometheus (port 9090) — metrics collection
- Grafana (port 3000) — dashboards

Check `docker-compose.yml` for full service definitions.

---

## Git Workflow

### Branching Strategy

Follow the convention from [CONTRIBUTING.md](../CONTRIBUTING.md):

```
feat/short-description       — New features
fix/short-description        — Bug fixes
docs/short-description       — Documentation
refactor/short-description   — Code improvements
infra/short-description      — CI/CD, Docker, build setup
```

Example:
```bash
git checkout -b feat/trade-search-filters
git checkout -b fix/escrow-release-edge-case
git checkout -b docs/api-contract-examples
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(trades): add search filters for trade list

Implement full-text search on trade metadata, support filtering by
status, date range, and counterparty. Closes #123.
```

Format:
```
<type>(<scope>): <short description>

<optional extended description>

Closes #<issue-number>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `infra`

### Creating a Pull Request

1. **Push to your fork**
   ```bash
   git push origin feat/my-feature
   ```

2. **Open PR on GitHub**
   - Target: `main` branch
   - Title: Keep under 70 characters
   - Use PR template from [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md)

3. **Fill in PR description**
   - Summary of changes
   - Related issues (e.g., "Closes #123")
   - Testing steps
   - Screenshots (if UI changes)

4. **Ensure CI passes**
   - All status checks must pass
   - Address review feedback
   - Maintainer merges PR

---

## Testing Your Changes

### Backend Tests

```bash
cd backend

# Run all tests
npm test

# Run specific test file
npm test -- src/__tests__/trades.test.ts

# Watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### Frontend Tests

```bash
cd frontend

# Run unit tests
npm test

# Watch mode
npm test -- --watch

# Visual regression tests
npm run test:visual

# Update snapshots (if intentional design changes)
npm run test:visual:update

# Coverage report
npm test -- --coverage
```

### Contract Tests

```bash
cd contracts/amana_escrow

# Run tests
cargo test --locked

# Run with output
cargo test -- --nocapture
```

### routes-d Tests

```bash
cd routes-d

# Run tests (Vitest with 80% coverage threshold)
npm test

# Type-check / lint
npm run lint
```

The route-building service tests stub the Stellar SDK, so no network access is
required.

### Full CI Simulation

Run locally what CI runs on your PR:

```bash
# Backend
cd backend
npm ci
npm run build
npm test

# Frontend
cd frontend
npm ci
npm run build
npm test
npm run test:visual

# Contracts
cd contracts/amana_escrow
cargo test --locked
cargo build --target wasm32-unknown-unknown --release
```

---

## Development Tips

### Using VS Code

Recommended extensions:

- **ESLint** — Real-time linting feedback
- **Prettier** — Code formatting
- **TypeScript** — Type checking
- **Playwright** — Visual test debugging
- **Rust Analyzer** — Smart IDE for Rust

### IDE Configuration

Most settings are already configured in [.vscode/settings.json](../.vscode/settings.json):
- Tab size: 2 spaces
- Automatic formatting on save
- Strict TypeScript checking

### Environment Variables During Development

Create `.env.local` files to override development defaults:

```bash
# backend/.env.local
NODE_ENV=development
DEBUG=amana:*

# frontend/.env.local
NEXT_PUBLIC_DEBUG=true
```

### Debugging

#### Backend (Node.js)

```bash
# Start with debugger
node --inspect-brk dist/index.js

# Or in VS Code:
# 1. Set breakpoint
# 2. Run Debug configuration
# 3. Step through code
```

#### Frontend (Next.js)

```bash
# Browser DevTools
npm run dev
# Open http://localhost:3000 and press F12
```

### Database Migrations

```bash
cd backend

# Create new migration
npx prisma migrate dev --name add_field_name

# Apply migrations
npx prisma migrate dev

# Reset database (development only!)
npx prisma migrate reset
```

---

## Code Quality Standards

### TypeScript & Linting

```bash
# Run linter
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

**Key Rules** (from CONTRIBUTING.md):
- Strict type checking enabled (`strict: true`)
- Avoid `any` types — use explicit interfaces
- Prefer Zod schemas for runtime validation
- Type all function parameters and return values

### Code Style

- **Indentation**: 2 spaces
- **Line length**: Aim for 80 characters (soft limit)
- **Comments**: Only for "why", not "what"
- **Imports**: Organized and grouped

### Testing Standards

- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for critical user flows
- Visual regression tests for UI
- Aim for >80% code coverage

---

## Common Tasks

### Adding a New API Endpoint

1. **Create controller** (`backend/src/controllers/my.controller.ts`)
2. **Create route** (`backend/src/routes/my.routes.ts`)
3. **Add tests** (`backend/src/__tests__/my.test.ts`)
4. **Register route** in `backend/src/app.ts`
5. **Document** in OpenAPI spec (`backend/src/docs/openapi.yaml`)

### Adding a New Frontend Component

1. **Create component** (`frontend/src/components/MyComponent.tsx`)
2. **Add tests** (`frontend/src/components/__tests__/MyComponent.test.tsx`)
3. **Export** from `frontend/src/components/index.ts`
4. **Document** with Storybook (if applicable)

### Modifying the Database Schema

1. **Update** `backend/prisma/schema.prisma`
2. **Create migration** (`npx prisma migrate dev --name description`)
3. **Test** locally with `npm test`
4. **Commit** migration file alongside code changes

### Deploying a Smart Contract Update

1. **Update** `contracts/amana_escrow/src/lib.rs`
2. **Test locally** (`cargo test`)
3. **Build WASM** (`cargo build --features wasm --release`)
4. **Run safety check** (`./scripts/check-contract-deployment-safety.sh`)
5. **Create PR** with all safety checks passing

---

## Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

#### Node Modules Issues
```bash
# Clear and reinstall
rm -rf node_modules pnpm-lock.yaml
npm install
```

#### Database Connection Error
```bash
# Verify DATABASE_URL in .env
# Restart PostgreSQL
docker-compose restart db

# Reset database
cd backend && npx prisma migrate reset
```

#### Docker Compose Won't Start
```bash
# Check Docker daemon
docker ps

# Rebuild containers
docker-compose down
docker-compose up -d

# View logs
docker-compose logs -f
```

### Getting Help

- **Docs**: Check [docs/](.)
- **Issues**: Search existing GitHub issues
- **Discord**: Join our community server (link in README)
- **Code Review**: Ask in PR comments

---

## Recommended Resources

### Learning Materials

- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Smart Contracts](https://soroban.stellar.org/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Express.js Guide](https://expressjs.com/)
- [Playwright Testing](https://playwright.dev/)

### Architecture & Design

- [System Architecture](./architecture.md)
- [Sequence Diagrams](./sequence-diagrams.md)
- [Architecture Decision Records](./adr/)
- [Data Model](./data-model-relationships.md)

### Operations & Deployment

- [Docker Profiles](./docker-profiles.md)
- [Contract Deployment](./contract-deployment-local-network.md)
- [Migration Rollback](./migration-rollback-playbook.md)

---

## Next Steps

1. **Set up your environment** using the stack-specific guides above
2. **Read** [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines
3. **Pick an issue** labeled `good-first-issue` or `help-wanted`
4. **Create a branch** and start coding
5. **Run tests** and ensure CI passes
6. **Submit a PR** with a clear description
7. **Engage with reviewers** and iterate

---

## Contributing Changes

Follow this workflow for every contribution:

```bash
# 1. Create feature branch
git checkout -b feat/my-feature

# 2. Make changes and commit
git add .
git commit -m "feat(scope): description"

# 3. Push to your fork
git push origin feat/my-feature

# 4. Open PR on GitHub
# 5. Wait for CI to pass
# 6. Address review feedback
# 7. Maintainer merges
```

---

## Feedback

Have suggestions for this onboarding guide? Found an error? Please:

1. Open an issue with `docs:` prefix
2. Submit a PR with improvements
3. Ask in our community Discord

Thank you for contributing to Amana! 🌾
