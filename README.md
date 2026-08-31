# 🌾 Amana: Trust as a Service for Agricultural Products

[![codecov](https://codecov.io/gh/KingFRANKHOOD/Amana/branch/main/graph/badge.svg)](https://codecov.io/gh/KingFRANKHOOD/Amana)

![Stellar](https://img.shields.io/badge/Network-Stellar-black?style=for-the-badge&logo=stellar)
![Soroban](<https://img.shields.io/badge/Contracts-Soroban%20(Rust)-orange?style=for-the-badge>)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Amana** is a decentralized escrow protocol designed to secure agricultural trade across different regions. By leveraging **Soroban Smart Contracts**, Amana eliminates the "Trust Gap" between buyers and sellers, ensuring fair trade even when parties are hundreds of miles apart.

This is the main repository containing the smart contracts and orchestration logic. Backend, frontend, and mobile applications are maintained in this monorepo for simpler development and unified deployment.

---

## 🚀 The Mission

To provide a programmable safety net for regional commodity trading. Amana ensures that the risk of "sending first" is eliminated, replaced by a secure, neutral vault that only releases funds when delivery is verified.

## 🛠 Features

- **Smart Escrow:** Secure funds holding using cNGN/stablecoins on the Stellar network.
- **Dynamic Loss Sharing:** Negotiable risk-sharing ratios (e.g., 50/50, 70/30) hardcoded into every trade to handle transit accidents or theft.
- **Proof-of-Delivery (PoD):** An optional video-based verification protocol involving the buyer and the driver to confirm the state of goods. Video evidence can be submitted and stored on IPFS for dispute resolution.
- **Volatility Protection:** Utilizes Stellar Path Payments to allow users to pay in local currency (NGN) while locking value in cNGN.
- **Automated Settlement:** A flat 1% platform fee is automatically deducted upon successful trade completion.

## 🏗 Technical Stack

- **Frontend:** [Next.js](https://nextjs.org/) (App Router)
- **Smart Contracts:** [Soroban](https://soroban.stellar.org/) (Rust)
- **Blockchain:** [Stellar Network](https://www.stellar.org/)
- **Wallet Connection:** [Freighter](https://www.freighter.app/) / [Albedo](https://albedo.link/)
- **Storage:** IPFS (via Pinata) for decentralized storage of video evidence.
- **Database:** Supabase (Off-chain metadata, driver logs, and user profiles).
- **Observability:** OpenTelemetry distributed tracing with correlation IDs for end-to-end request tracking.

## 🧪 Local Environments (Folder-Based)

- `frontend/` → Next.js app environment (UI + wallet + Supabase/Pinata client integration)
- `backend/` → Node.js/TypeScript API environment (Supabase + Pinata + integration endpoints)
- `mobile/` → React Native Expo environment (mobile wallet, notification, and trade UX)
- `contracts/` → Rust/Soroban smart contract environment

### Prerequisites

Amana uses **pnpm** as the package manager. Install it globally:

```bash
npm install -g pnpm
```

### Frontend setup

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm run dev
```

### Backend setup

```bash
cd backend
cp .env.example .env
cp .env.tracing.example .env.tracing  # for distributed tracing configuration
pnpm install
pnpm run dev
```

### Mobile setup

```bash
cd mobile
cp .env.example .env.local
pnpm install
pnpm start
```

### Backend API docs

- Source of truth: `backend/src/docs/openapi.yaml`
- Dev Swagger UI: `http://localhost:4000/api/docs`
- JSON export: `http://localhost:4000/api/docs/openapi.json`
- **API contract examples**: [`backend/docs/api-contract-examples.md`](./backend/docs/api-contract-examples.md) — JS/TypeScript snippets for authentication and all trade operations
- **SDK usage guide**: [`backend/docs/sdk-usage.md`](./backend/docs/sdk-usage.md) — typed client wrapper for frontend, mobile, and Node.js

The backend writes `backend/src/docs/openapi.json` from the YAML spec in non-production runs so reviewers can inspect either format.

### Contracts setup

1. `cd contracts/amana_escrow`
2. `cargo build`

## 🔒 Required PR CI Gates

Amana enforces stack-level CI gates on pull requests through `.github/workflows/ci.yml`.

- **Frontend Required Gate**: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, `pnpm test` in `frontend/`
- **Backend Required Gate**: `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm test` in `backend/`
- **Mobile Required Gate**: `pnpm install --frozen-lockfile`, `pnpm run type-check`, `pnpm run lint` in `mobile/`
- **Contracts Required Gate**: `cargo test` in `contracts/amana_escrow/`

Path-aware execution is enabled to avoid unnecessary runtime. If a stack has no changed files, the gate reports a skip-note and passes.

### Branch protection setup (GitHub)

For the protected branch (`main`), set these required status checks:

- `Frontend Required Gate`
- `Backend Required Gate`
- `Contracts Required Gate`

---

---

## 🔄 How It Works (The Amana Flow)

1. **Initiate:** The Seller lists products. The Buyer initiates a trade, depositing funds that are converted to cNGN via a Stellar Path Payment.
2. **Lock:** The Smart Contract locks the funds and stores the agreed-upon `Loss_Ratio`.
3. **Dispatch:** The Seller provides the driver's name, phone number, and vehicle manifest.
4. **Verification:** - **Success:** Buyer receives goods and uploads a confirmation video. Funds release to Seller.
   - **Dispute:** Buyer uploads a video of loss/damage with driver affirmation. A mediator reviews the evidence.
5. **Settlement:** Based on the outcome, funds are distributed (either 100% to one party or split via the `Loss_Ratio`).

---

## 🗺 Roadmap

### Phase 1: The Vault (MVP)

- [x] Develop core Soroban contract logic (`deposit`, `release`, `refund`).
- [x] Implement basic Next.js UI for trade creation.

### Phase 2: The Agreement Engine

- [x] Integrate `Loss_Ratio` variables into the smart contract.
- [x] Build the "Mediator" dashboard for dispute resolution.

### Phase 3: Evidence & Logistics

- [x] IPFS integration for video evidence uploads.
- [x] Driver manifest logging and tracking interface.

### Phase 4: Mainnet & Scale

- [ ] Public pilot program with regional agricultural cooperatives.
- [x] Implementation of a "Trust Score" reputation system.

---

## 🔍 Distributed Tracing

Amana includes comprehensive distributed tracing with OpenTelemetry for end-to-end request visibility and faster incident triage.

### Features

- **Correlation IDs**: Unique identifiers spanning frontend-backend requests
- **Request Tracing**: Complete request lifecycle tracking
- **Service Integration**: Automatic tracing for external services (IPFS, Stellar)
- **Observability**: Jaeger, Zipkin, and Prometheus integration

### Quick Start

1. Configure tracing environment variables (see `backend/.env.tracing.example`)
2. Start Jaeger for trace visualization: `docker run -p 16686:16686 jaegertracing/all-in-one`
3. View traces at `http://localhost:16686`
4. Check metrics at `http://localhost:9464/metrics`

### Documentation

See [DISTRIBUTED_TRACING_GUIDE.md](./DISTRIBUTED_TRACING_GUIDE.md) for detailed setup and usage instructions.

**Logging & Observability**:
- **[Logging Standards](./docs/LOGGING_STANDARDS.md)** — Comprehensive logging standards across all stacks (backend Pino, frontend TracedHttpClient, mobile, contracts, background jobs, log levels, PII redaction, Loki queries, and retention)
- **[Error Logging Standards](./docs/ERROR_LOGGING_STANDARDS.md)** — Structured error logging with AppError, error correlation IDs, and Zod validation errors

**Application Metrics & Monitoring**:
- **[Prometheus Metrics](./docs/PROMETHEUS_METRICS.md)** — Trade throughput, dispute counts, and processing latency metrics exposed at `/metrics`

#### System Architecture & Data Flow

- **[System Architecture](./docs/architecture.md)** — High-level architecture overview, component interactions, and deployment topology
- **[Sequence Diagrams](./docs/sequence-diagrams.md)** — Detailed workflow sequences for trade creation, dispute resolution, audit trails, and more
- **[Data Model & Relationships](./docs/data-model-relationships.md)** — Complete database schema and entity relationships
- **[Audit Logging](./docs/audit-logging.md)** — Tamper-evident audit trail with cryptographic signatures and verification
- **[Event Flow](./docs/event-flow.md)** — State machine and event propagation throughout the system
- **[Mediator Dashboard Spec](./docs/mediator-dashboard-spec.md)** — Complete specification for mediator dashboard including user stories, UI mockups, and implementation tasks

**Testing & Quality Assurance**:
- **[Visual Regression Testing](./docs/VISUAL_REGRESSION_TESTING.md)** — Frontend UI regression tests using Playwright with multi-viewport support

---

## 📐 Architecture Decision Records

Key architectural decisions are documented as ADRs in [`docs/adr/`](./docs/adr):

- [ADR-001: Stellar Path Payment Architecture](./docs/adr/ADR-001-stellar-path-payment-architecture.md)
- [ADR-002: Escrow Loss-Sharing Model](./docs/adr/ADR-002-escrow-loss-sharing-model.md)
- [ADR-003: Off-chain vs. On-chain Data Partitioning](./docs/adr/ADR-003-offchain-vs-onchain-data-partitioning.md)
- [ADR-004: Idempotency and Retry Strategy](./docs/adr/ADR-004-idempotency-and-retry-strategy.md)
- [ADR-005: Frontend State Management](./docs/adr/ADR-005-frontend-state-management.md)
- [ADR-008: CI/CD Pipeline Architecture](./docs/adr/ADR-008-cicd-pipeline-architecture.md)

## 🤝 Contributing

Amana is an open-source project aimed at improving food security and trade efficiency. We welcome developers, designers, and agricultural experts!

**New to the project?** Start with the [Contributor Onboarding Guide](./docs/CONTRIBUTOR_ONBOARDING.md) for setup instructions and development workflows.

**Full guidelines**: See [CONTRIBUTING.md](./CONTRIBUTING.md) for code standards, testing requirements, and PR process.

Quick start:
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/NewFeature`).
3. Commit your Changes (`git commit -m 'Add NewFeature'`).
4. Push to the Branch (`git push origin feature/NewFeature`).
5. Open a Pull Request.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

// setting up and starting out
