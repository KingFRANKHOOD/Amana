# Amana System Architecture

## Overview

Amana is a decentralized financial escrow platform built on Stellar blockchain. The system architecture follows a three-tier model with frontend, backend, and smart contracts.

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Browser (Frontend)                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ React 19 + Next.js 16                                      │   │
│  │ - User authentication (Freighter wallet)                   │   │
│  │ - Trade creation and management UI                         │   │
│  │ - Evidence upload and submission                           │   │
│  │ - Dispute workflow and evidence review                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                    HTTPS (REST/JSON)
                           │
┌──────────────────────────┴──────────────────────────────────────────┐
│                    Amana Backend (Node.js)                           │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ API Gateway & Express Middleware                          │   │
│  │ - JWT Authentication & Authorization                      │   │
│  │ - Request logging and rate limiting                       │   │
│  │ - Error handling and validation                           │   │
│  └────────────────────────────────────────────────────────────┘   │
│                            │                                        │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Service Layer                                              │   │
│  │ - Trade Service: lifecycle and state management           │   │
│  │ - Dispute Service: conflict resolution                    │   │
│  │ - Audit Trail Service: tamper-evident event logging       │   │
│  │ - Evidence Service: file upload and verification          │   │
│  │ - Stellar Integration: blockchain interaction            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                            │                                        │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Data Access Layer (Prisma ORM)                             │   │
│  │ - Database abstraction and query building                  │   │
│  │ - Schema management via migrations                         │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────┬──────────────────────────────────┬──────────────────┬───┘
           │                                  │                  │
           │                                  │                  │
           ▼                                  ▼                  ▼
    ┌────────────┐                  ┌──────────────┐    ┌──────────────┐
    │ PostgreSQL │                  │ Stellar RPC  │    │ IPFS/Pinata  │
    │ Database   │                  │ Soroban      │    │ File Storage │
    └────────────┘                  │ Contracts    │    └──────────────┘
                                    └──────────────┘

```

## Component Architecture

### Frontend Layer (Next.js + React)

| Component | Responsibility |
|-----------|-----------------|
| Pages | Trade listing, details, creation, dispute views |
| Components | Reusable UI elements (forms, modals, cards) |
| Hooks | State management via Zustand |
| API Client | HTTP requests to backend |
| Auth Flow | Freighter wallet integration |

**Technology Stack:**
- Framework: Next.js 16.1.6, React 19.2.3
- State: Zustand
- UI: Tailwind CSS, Radix UI, Lucide Icons
- Testing: Jest, Playwright, Testing Library

### Backend Layer (Node.js + Express)

#### API Routes
- `/trades` - Trade CRUD operations
- `/disputes` - Dispute management
- `/audit` - Audit trail and verification
- `/evidence` - File upload and management
- `/health` - Liveness and readiness probes

#### Services

```
AuditTrailService
├── getTradeHistory(tradeId, callerAddress)
├── getCanonicalPayload(tradeId, events)
├── signPayload(payload)
└── verifyPayload(payload, signature)

TradeService
├── createTrade(params)
├── fundTrade(tradeId, txHash)
├── deliverTrade(tradeId)
├── completeTrade(tradeId)
└── listTrades(filters)

DisputeService
├── initiatDispute(tradeId, reason)
├── submitEvidence(disputeId, evidence)
├── resolvDispute(disputeId, outcome)
└── getDisputeHistory(tradeId)

EvidenceService
├── uploadFile(file)
├── verifyIpfsHash(cid, localFile)
├── getFileMetadata(cid)
└── cleanupExpiredFiles()

StellarService
├── buildTransaction(params)
├── signTransaction(tx)
├── submitTransaction(tx)
└── getAccountBalance(address)
```

#### Middleware Pipeline

```
Request
  │
  ├─► Request Logger Middleware
  │    (logs incoming requests)
  │
  ├─► CORS Middleware
  │    (cross-origin request handling)
  │
  ├─► Auth Middleware
  │    (JWT validation & extraction)
  │
  ├─► Validation Middleware
  │    (Zod schema validation)
  │
  ├─► Route Handler
  │    (service invocation)
  │
  ├─► Error Handler Middleware
  │    (standardized error responses)
  │
  └─► Response Logger
       (logs outgoing responses)
```

### Data Layer (Prisma ORM)

#### Key Entities

```
Trade
├── tradeId (PK)├── buyerAddress (FK: User)
├── sellerAddress (FK: User)
├── amountUsdc (Decimal)
├── status (CREATED|FUNDED|DELIVERED|COMPLETED|DISPUTED|CANCELLED)
├── createdAt
├── fundedAt
├── deliveredAt
├── completedAt
└── updatedAt

DeliveryManifest
├── tradeId (FK: Trade, PK)
├── vehicleRegistration
├── expectedDeliveryAt
├── createdAt
└── updatedAt

Dispute
├── tradeId (FK: Trade, PK)
├── initiator (User Address)
├── reason
├── status (PENDING|RESOLVED)
├── resolution
├── createdAt
├── resolvedAt
└── updatedAt

TradeEvidence
├── evidenceId (PK)
├── tradeId (FK: Trade)
├── cid (IPFS content hash)
├── filename
├── mimeType
├── uploadedBy (User Address)
├── createdAt
└── ipfsExpiresAt
```

### Route-building Layer (`routes-d/`)

`routes-d/` is a standalone Stellar route-building service (`Node.js +
Express + @stellar/stellar-sdk`). It is deliberately separate from the main
backend because its only job is to construct **unsigned** Stellar transaction
envelopes (XDR) against Horizon and to proxy read-only Horizon data. It has no
database and no secrets.

Clients (mobile and web) call `routes-d` to get a ready-to-sign envelope for a
path payment, trustline change, etc.; the client signs it locally in their
wallet and submits it to the Stellar network. Zod schemas validate every
request body.

Routers (`routes/`):

| Router | Responsibility |
|---|---|
| `stellar.ledger.ts` | Latest ledger info (`GET /ledger/latest`) |
| `stellar.payments.ts` | Payment history for an account (`GET /:address/payments`) |
| `stellar.trustline.ts` | Build trustline add/remove envelopes (`POST/DELETE /trustline`) |
| `stellar.payment.strictSend.ts` | Path payment (send fixed amount) envelopes (`POST /strict-send`) |
| `stellar.payment.strictReceive.ts` | Path payment (receive fixed amount) envelopes (`POST /strict-receive`) |

Configuration is via `STELLAR_NETWORK` (`testnet` default, or `mainnet`), which
selects the Horizon endpoint and network passphrase. See
[`routes-d/README.md`](../routes-d/README.md) and
[ADR-009](./adr/ADR-009-route-building-service-separation.md) for details.

## Data Flow Diagrams

### Trade Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CREATED State                                │
│  - Buyer creates trade with seller address and amount               │
│  - Trade record inserted into database                              │
│  - Event: CREATED logged in audit trail                             │
│  - Awaits funding                                                   │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ Buyer funds escrow (Stellar payment)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FUNDED State                                 │
│  - Smart contract receives USDC payment                             │
│  - Trade status updated to FUNDED                                   │
│  - Event: FUNDED logged with tx hash                                │
│  - Seller notified via webhook                                      │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ Seller submits delivery manifest
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MANIFEST_SUBMITTED State                          │
│  - Delivery manifest recorded (vehicle registration, expected date) │
│  - Event: MANIFEST_SUBMITTED logged                                 │
│  - Buyer notified of impending delivery                             │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ Parties may submit evidence (photos, videos)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              VIDEO_SUBMITTED/EVIDENCE_SUBMITTED State               │
│  - Evidence files uploaded to IPFS via Pinata                       │
│  - Metadata stored in database (CID, filename, MIME type)           │
│  - Events logged for each submission                                │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ One of two paths:
         │
         ├─────────────────────────┬───────────────────────────┐
         │                         │                           │
         ▼ (No disputes)           ▼ (Dispute raised)         ▼
┌──────────────────┐     ┌──────────────────┐    ┌─────────────────┐
│   DELIVERY_      │     │    DISPUTE       │    │   DISPUTE       │
│   CONFIRMED      │     │   INITIATED      │    │  RESOLUTION     │
│                  │     │                  │    │                 │
│ Buyer confirms   │     │ Either party     │    │ Mediator reviews│
│ receipt          │     │ initiates dispute│    │ evidence and    │
│                  │     │ with reason      │    │ determines      │
│ Event: DELIVERY_ │     │                  │    │ outcome         │
│ CONFIRMED logged │     │ Event: DISPUTE_  │    │                 │
│                  │     │ INITIATED logged │    │ Event: RESOLVED │
│                  │     │                  │    │ logged          │
└────────┬─────────┘     └────────┬─────────┘    └────────┬────────┘
         │                        │                       │
         │                        └───────────┬───────────┘
         │                                    │
         ▼                                    ▼
    ┌─────────────┐              ┌──────────────────────┐
    │  COMPLETED  │              │  COMPLETED/CANCELLED │
    │             │              │                      │
    │ Settlement  │              │ Funds returned or    │
    │ executed    │              │ released based on    │
    │ Escrow      │              │ dispute outcome      │
    │ released    │              │                      │
    └─────────────┘              └──────────────────────┘
```

### Audit Trail Generation

```
GET /trades/:id/history?signed=true

┌──────────────────────────────────────┐
│   Fetch Trade and Events from DB     │
├──────────────────────────────────────┤
│ 1. Load Trade record                 │
│ 2. Query DeliveryManifest            │
│ 3. Query TradeEvidence (ordered)     │
│ 4. Query Dispute record              │
│ 5. Build event sequence              │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Apply Access Control                 │
├──────────────────────────────────────┤
│ - Buyer: Can access own trades       │
│ - Seller: Can access own trades      │
│ - Mediator: Access if dispute exists │
│ - Admin: Can access all trades       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Mask Sensitive Data                  │
├──────────────────────────────────────┤
│ - Vehicle registration → ABC***      │
│ - Evidence (if expired) → redacted   │
│ - Admin can view unmasked data       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Build Canonical Payload              │
├──────────────────────────────────────┤
│ {                                    │
│   tradeId: "trade-001",              │
│   generatedAt: "2026-01-15T10:30Z",  │
│   events: [                          │
│     {                                │
│       eventType: "CREATED",          │
│       timestamp: "2026-01-01T...",   │
│       actor: "GC...",                │
│       metadata: {...}                │
│     },                               │
│     ...                              │
│   ]                                  │
│ }                                    │
└──────────────┬───────────────────────┘
               │
               ├─────────────┬─────────────────┐
               │             │                 │
               ▼             ▼                 ▼
        ┌─────────────┐  ┌──────────────┐  ┌─────────┐
        │   JSON      │  │  CSV Export  │  │ Signing │
        │   Response  │  │              │  │         │
        └─────────────┘  └──────────────┘  │ 1. Hash │
                                           │    SHA  │
                                           │    256  │
                                           │         │
                                           │ 2. Sign │
                                           │    Ed25 │
                                           │    519  │
                                           │         │
                                           │ 3. Gen  │
                                           │    Meta │
                                           └─────────┘
```

### Dispute Resolution Workflow

```
┌──────────────────────────────────────────────────────────────┐
│                    Dispute Initiated                          │
│  Buyer or Seller calls POST /disputes/initiate               │
│  - Reason provided (quality, non-delivery, etc.)             │
│  - Evidence collection begins                                │
│  - Mediator assigned (if configured)                         │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│              Evidence Submission Phase                        │
│  Both parties submit supporting evidence:                    │
│  - Photos of item/receipt                                    │
│  - Videos of condition assessment                            │
│  - Communication transcripts                                 │
│  - Shipping confirmations                                    │
│                                                               │
│  All evidence:                                               │
│  1. Uploaded to IPFS (immutable)                             │
│  2. CID stored in database                                   │
│  3. Audit trail events recorded                              │
│  4. Retention timer started (90 days)                        │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│            Mediator Review & Resolution                      │
│  Mediator accesses:                                          │
│  - Complete audit trail (tamper-evident)                     │
│  - All submitted evidence via IPFS                           │
│  - Communication history                                     │
│                                                               │
│  Decision options:                                           │
│  - Full refund to buyer                                      │
│  - Release funds to seller                                   │
│  - Partial split (if applicable)                             │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│              Settlement Execution                            │
│  Based on mediator decision:                                 │
│  1. Smart contract invoked with resolution                   │
│  2. Escrow funds released to winner                          │
│  3. Settlement recorded on-chain                             │
│  4. Trade marked COMPLETED                                   │
│  5. Event: RESOLVED logged in audit trail                    │
└──────────────────────────────────────────────────────────────┘
```

## External Integrations

### Stellar Blockchain

```
Application        Stellar Network
     │                    │
     │──Build TX────────>│
     │  (payment)         │
     │                    │
     │<─Submit TX─────────│
     │                    │
     │──Poll Status────>│
     │                  │
     │<─Confirm────────│
```

### IPFS (via Pinata)

```
Application        Pinata API        IPFS Network
     │                 │                   │
     │──Upload File──>│                   │
     │                 │──Add to IPFS───>│
     │                 │                  │
     │<─Return CID────│<─CID──────────────│
     │                 │                   │
     │──Retrieve────>│──Get from IPFS───>│
     │                 │<─File─────────────│
     │<─File─────────│
```

## Security Architecture

### Authentication & Authorization

```
User Request
     │
     ├─► JWT Token (from /auth/login)
     │
     ├─► Extract wallet address
     │
     ├─► Validate token signature
     │
     ├─► Check token expiration
     │
     ├─► Verify wallet not in revocation list
     │
     └─► Proceed with authorization checks
          (buyer/seller/mediator/admin roles)
```

### Audit & Compliance

```
All State Changes
     │
     ├─► Generate event record
     │
     ├─► Store in database (immutable append-only)
     │
     ├─► Compute SHA-256 hash
     │
     ├─► Sign with Ed25519 private key
     │
     ├─► Store signature + metadata
     │
     └─► Enable cryptographic verification
          (for auditors and compliance)
```

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│        Load Balancer (Optional)         │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
    ┌─────────┐       ┌─────────┐
    │Backend  │       │Backend  │
    │Instance │   ...│Instance │
    │ (Node)  │       │ (Node)  │
    └────┬────┘       └────┬────┘
         │                 │
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │   PostgreSQL    │
         │   Primary DB    │
         └─────────────────┘
```

## CI Pipeline

The CI workflow detects changes independently for `frontend`, `backend`,
`mobile`, `contracts`, and `routes-d`. Changes under `routes-d/` run a
dedicated Node 20 job using its committed npm lockfile. That job runs npm audit,
TypeScript build and lint checks, Vitest with an 80% line, function, branch, and
statement coverage threshold, and uploads the LCOV report to Codecov. The
change-gated Trivy filesystem scan also covers `routes-d`.

## Observability Stack

- **Logging**: Pino (structured logs)
- **Tracing**: OpenTelemetry (distributed tracing)
- **Metrics**: Prometheus (application metrics)
- **Visualization**: Grafana (dashboards)
- **Sampling**: Jaeger/Zipkin (trace collection)

## Performance Considerations

### Database
- Read replicas for audit queries (immutable data)
- Indexes on tradeId, buyerAddress, sellerAddress
- Time-series partitioning for audit tables

### Caching
- Redis for JWT blacklist (token revocation)
- In-memory caching for configuration
- HTTP cache headers for static assets

### Async Processing
- BullMQ for event processing
- Webhook delivery for notifications
- Scheduled cleanup of expired evidence
