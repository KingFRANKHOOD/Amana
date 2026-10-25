# 🌾 Amana Backend Service

The official Node.js/TypeScript backend for **Amana**, a decentralized escrow protocol designed to secure agricultural trade across different regions.

Amana eliminates the "Trust Gap" between buyers and sellers using Soroban Smart Contracts on the Stellar network, ensuring fair trade even when parties are hundreds of miles apart.

## About Amana

**Amana** provides a programmable safety net for regional commodity trading:

- **Smart Escrow**: Secure funds holding using cNGN/stablecoins on the Stellar network
- **Dynamic Loss Sharing**: Negotiable risk-sharing ratios (e.g., 50/50, 70/30) for handling transit accidents
- **Proof-of-Delivery (PoD)**: Mandatory video-based verification involving buyer and driver
- **Automated Settlement**: Flat 1% platform fee deducted upon successful trade completion
- **Volatility Protection**: Stellar Path Payments allow users to pay in local currency (NGN) while locking value in cNGN

## Backend Responsibilities

This service provides the API and infrastructure integration layer for the Amana escrow protocol.
It handles trade orchestration, Supabase metadata, IPFS/Pinata uploads, Stellar payment bridging, and OpenTelemetry tracing.

## Features

- Node.js + TypeScript backend service
- Express API server
- Prisma ORM for database access
- Supabase integration for off-chain metadata
- Pinata SDK for IPFS uploads
- Stellar SDK for transaction and wallet interactions
- OpenTelemetry tracing with Jaeger/Prometheus/Zipkin exporters
- Jest test suite for backend behavior

## Getting Started

### Prerequisites

- Node.js 20+ / npm
- Access to required environment variables
- Supabase database and/or Redis as required by your environment

### Install dependencies

```bash
cd backend
npm install
```

### Environment

Copy the example env files and configure your secrets:

```bash
cp .env.example .env
cp .env.tracing.example .env.tracing
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run production

```bash
npm run start
```

### Tests

```bash
npm test
```

## Security & request input policy

The backend uses a narrow global normalization layer before route handlers run. It strips dangerous prototype-pollution keys such as `__proto__`, `constructor`, and `prototype`, and it removes control characters from incoming string values. It does not HTML-escape ordinary JSON API strings or rewrite protocol/security-sensitive values.

The actual business rules live at the route boundary via `validateRequest` plus Zod schemas. Params, query strings, and request bodies are validated where appropriate for identifiers, wallet addresses, asset codes, hashes, numeric IDs, and structured payloads. Free-form text is only rejected when the schema explicitly checks for script-like payloads in fields meant to be stored or displayed to users; valid user text remains accepted unless it violates the field contract.

Sensitive headers and raw verification values are preserved exactly. This includes `Authorization`, cookies, JWTs, webhook/signature headers, API keys, hashes, and raw signed payloads. Those values are never normalized or HTML-escaped because they are protocol data, not rich text.

## Notes

- `prisma/` contains schema and seed logic for the backend database.
- `src/` contains the Express server, routes, middleware, services, and docs.
- `dist/` is the compiled output directory created by `npm run build`.

## Health & Readiness Checks

The backend exposes several health endpoints for monitoring and orchestration:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Aggregate health — returns `healthy`, `degraded`, or `unhealthy` based on all dependency checks |
| `GET /health/live` | Liveness probe — always returns `200` if the process is running |
| `GET /health/ready` | Readiness probe — returns `200` only when critical dependencies (database, Redis, config) are up |
| `GET /health/startup` | Startup check — fails with `503` if critical dependencies are down at boot |
| `GET /health/detail` | Per-dependency latency & status for every external service |

### Dependency checks performed

| Dependency | Type | Critical for startup |
|---|---|---|
| **Database (Supabase/Prisma)** | SQL query `SELECT 1` with 200ms timeout | Yes |
| **Redis** | `PING` with 3s timeout | Yes |
| **Stellar node** | `loadAccount` call with 5s timeout | No (degraded if down) |
| **IPFS/Pinata** | `testAuthentication` with 5s timeout | No (degraded if down) |
| **Indexer** | Latest processed ledger age (<15s threshold) | No (unhealthy if lagging) |
| **Configuration** | Validates critical env vars are present | Yes |

Startup readiness (`GET /health/startup`) fails with `503` if **database**, **Redis**, or **config** checks fail. All other dependencies report as degraded without blocking startup.

## Repository Scope

This backend service lives inside the `backend/` folder of the Amana monorepo and provides the API, database, and infrastructure integration for the project.
