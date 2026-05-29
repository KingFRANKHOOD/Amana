# Data Model Relationships

This document describes the backend data models, their fields, relationships, and the
business rules that govern state transitions. It is the authoritative reference for the
Prisma schema at `backend/prisma/schema.prisma`.

---

## 1. Enums

### TradeStatus

| Value             | Description                                       |
|-------------------|---------------------------------------------------|
| `PENDING_SIGNATURE` | Trade created off-chain, awaiting on-chain funding |
| `CREATED`         | Trade initialized on-chain                        |
| `FUNDED`          | Buyer deposited USDC into escrow                  |
| `DELIVERED`       | Seller confirmed delivery                         |
| `COMPLETED`       | Funds released to seller (or after dispute)       |
| `DISPUTED`        | Buyer or seller initiated a dispute               |
| `CANCELLED`       | Trade cancelled before funding                    |

### DisputeStatus

| Value          | Description                              |
|----------------|------------------------------------------|
| `OPEN`         | Dispute filed, awaiting review           |
| `UNDER_REVIEW` | Mediator actively reviewing evidence      |
| `RESOLVED`     | Mediator issued a decision                |
| `CLOSED`       | Dispute closed (funds released/refunded)  |

### GoalStatus

| Value       | Description               |
|-------------|---------------------------|
| `ACTIVE`    | Goal in progress          |
| `COMPLETED` | Target amount reached     |
| `CANCELLED` | Goal abandoned            |

### ChainEventSyncStatus

| Value          | Description                                        |
|----------------|----------------------------------------------------|
| `PENDING`      | Event received, not yet processed                  |
| `RETRYING`     | Processing failed, scheduled for retry              |
| `PROCESSED`    | Event handled successfully                         |
| `DEAD_LETTER`  | All retry attempts exhausted, requires intervention |

---

## 2. Entity Relationship Diagram (Text)

```
┌──────────────────────────────────────────────────────────────┐
│                           User                                │
│  id (PK) │ walletAddress (UK) │ displayName │ createdAt/At   │
└──────────┬──────────────────────────────────────┬────────────┘
           │ 1                      N             │
           │ tradesBought (buyer)                 │ tradesSold (seller)
           ▼                                      ▼
┌──────────────────────────────────────────────────────────────┐
│                           Trade                               │
│  id (PK) │ tradeId (UK) │ buyerAddress (FK) │ sellerAddress   │
│  amountUsdc │ status │ version │ fundedAt/deliveredAt/...      │
└───────┬──────────────┬──────────────────┬────────────────────┘
        │ 0..1          │ 0..1             │ N
        │               │                  │
        ▼               ▼                  ▼
┌──────────────┐ ┌──────────────────┐ ┌─────────────────┐
│   Dispute    │ │ DeliveryManifest │ │  TradeEvidence   │
│  tradeId(FK) │ │  tradeId (FK)    │ │  tradeId (FK)    │
│  initiator   │ │  driverName/hash │ │  cid │ filename  │
│  status      │ │  vehicleReg, etc │ │  mimeType │ etc  │
│  reason      │ └──────────────────┘ └─────────────────┘
│  categoryId  │
└──────┬───────┘
       │ N
       │
       ▼
┌──────────────────┐
│ DisputeCategory  │
│  id (PK)         │
│  name (UK)       │
│  description     │
│  isActive        │
└──────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                            Vault                              │
│  id (PK) │ vaultId (UK) │ ownerAddress (FK→User) │ balance   │
└──────────────────────────┬───────────────────────────────────┘
                           │ 1
                           │
                           ▼ N
┌──────────────────────────────────────────────────────────────┐
│                            Goal                               │
│  id (PK) │ goalId (UK) │ vaultId (FK→Vault) │ userId (FK→User)│
│  targetAmount │ currentAmount │ deadline │ status             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                      ProcessedEvent                           │
│  id (PK) │ ledgerSequence │ contractId │ eventId            │
│  ─ UNIQUE (ledgerSequence, contractId, eventId)              │
│  (Used for exactly-once event deduplication)                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                      ChainEventOutbox                         │
│  id (PK) │ ledgerSequence │ contractId │ eventId │ eventType │
│  tradeId │ payload (JSON) │ status │ attempts │ nextAttemptAt│
│  lastError │ deadLetteredAt │ processedAt                     │
│  ─ UNIQUE (ledgerSequence, contractId, eventId)              │
│  ─ INDEX (status, nextAttemptAt)  ── for retry polling        │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Model Reference

### 3.1 User

**Table**: `User`

| Column         | Type          | Constraints         | Description                                |
|----------------|---------------|---------------------|--------------------------------------------|
| `id`           | Int           | PK, autoincrement   | Internal primary key                       |
| `walletAddress`| VarChar(255)  | Unique, NOT NULL    | Stellar wallet address (lowercase)         |
| `displayName`  | VarChar(255)  | NOT NULL            | User display name                          |
| `createdAt`    | DateTime      | @default(now())     | Account creation timestamp                 |
| `updatedAt`    | DateTime      | @updatedAt          | Last update timestamp                      |

**Indexes**: `walletAddress`

**Relations**:
- `tradesBought` → **Trade[]** — trades where this user is the buyer
- `tradesSold` → **Trade[]** — trades where this user is the seller
- `initiatedDisputes` → **Dispute[]** — disputes initiated by this user
- `vaults` → **Vault[]** — savings vaults owned by this user
- `goals` → **Goal[]** — savings goals created by this user

### 3.2 Trade

**Table**: `Trade`

| Column            | Type          | Constraints         | Description                                   |
|-------------------|---------------|---------------------|-----------------------------------------------|
| `id`              | Int           | PK, autoincrement   | Internal primary key                          |
| `tradeId`         | VarChar(255)  | Unique, NOT NULL    | On-chain trade identifier                     |
| `buyerAddress`    | VarChar(255)  | FK→User             | Buyer wallet address (lowercase)              |
| `sellerAddress`   | VarChar(255)  | FK→User             | Seller wallet address (lowercase)             |
| `amountUsdc`      | VarChar(100)  | Default "0"         | Trade amount (string for precision)           |
| `buyerLossBps`    | Int           | Default 5000        | Buyer loss share in basis points (50% default)|
| `sellerLossBps`   | Int           | Default 5000        | Seller loss share in basis points (50% default)|
| `version`         | Int           | Default 0           | Optimistic concurrency counter                |
| `status`          | TradeStatus   | Default CREATED     | Current trade lifecycle status                |
| `fundedAt`        | DateTime?     | Nullable            | Set once when trade transitions to FUNDED     |
| `deliveredAt`     | DateTime?     | Nullable            | Set once when trade transitions to DELIVERED  |
| `completedAt`     | DateTime?     | Nullable            | Set once when trade transitions to COMPLETED  |
| `createdAt`       | DateTime      | @default(now())     | Record creation timestamp                     |
| `updatedAt`       | DateTime      | @updatedAt          | Last update timestamp                         |

**Indexes**: `tradeId`, `buyerAddress`, `sellerAddress`, `status`

**Relations**:
- `buyer` → **User** (M:1) — joined on `buyerAddress` → `walletAddress`
- `seller` → **User** (M:1) — joined on `sellerAddress` → `walletAddress`
- `dispute` → **Dispute?** (1:0..1) — optional dispute on this trade
- `manifest` → **DeliveryManifest?** (1:0..1) — optional delivery manifest
- `evidence` → **TradeEvidence[]** (1:N) — evidence files for this trade

### 3.3 Dispute

**Table**: `Dispute`

| Column       | Type          | Constraints         | Description                               |
|--------------|---------------|---------------------|-------------------------------------------|
| `id`         | Int           | PK, autoincrement   | Internal primary key                      |
| `tradeId`    | VarChar(255)  | Unique, FK→Trade    | Associated trade ID                       |
| `initiator`  | VarChar(255)  | FK→User             | Wallet address of the disputing party     |
| `reason`     | Text          | NOT NULL            | Reason for the dispute                    |
| `status`     | DisputeStatus | Default OPEN        | Current dispute state                     |
| `resolvedAt` | DateTime?     | Nullable            | Resolution timestamp                      |
| `categoryId` | Int?          | FK→DisputeCategory  | Optional dispute category                 |
| `createdAt`  | DateTime      | @default(now())     | Record creation timestamp                 |
| `updatedAt`  | DateTime      | @updatedAt          | Last update timestamp                     |

**Indexes**: `tradeId`, `initiator`, `status`, `categoryId`

**Relations**:
- `trade` → **Trade** (1:1) — joined on `tradeId` (cascade delete)
- `initiatorUser` → **User** (M:1) — joined on `initiator` → `walletAddress`
- `category` → **DisputeCategory?** (M:1) — joined on `categoryId`

### 3.4 DisputeCategory

**Table**: `DisputeCategory`

| Column        | Type          | Constraints         | Description                        |
|---------------|---------------|---------------------|------------------------------------|
| `id`          | Int           | PK, autoincrement   | Internal primary key               |
| `name`        | VarChar(100)  | Unique, NOT NULL    | Category name                      |
| `description` | Text?         | Nullable            | Optional description               |
| `isActive`    | Boolean       | Default true        | Soft-enable/disable flag           |
| `createdAt`   | DateTime      | @default(now())     | Record creation timestamp          |
| `updatedAt`   | DateTime      | @updatedAt          | Last update timestamp              |

**Indexes**: `name`, `isActive`

**Relations**:
- `disputes` → **Dispute[]** (1:N) — disputes assigned to this category

### 3.5 DeliveryManifest

**Table**: `DeliveryManifest`

| Column              | Type          | Constraints         | Description                                        |
|---------------------|---------------|---------------------|----------------------------------------------------|
| `id`                | Int           | PK, autoincrement   | Internal primary key                               |
| `tradeId`           | VarChar(255)  | Unique, FK→Trade    | Associated trade ID                                |
| `driverName`        | VarChar(255)  | NOT NULL            | Plaintext driver name (mediator-only access)        |
| `driverIdNumber`    | VarChar(255)  | NOT NULL            | Raw driver ID number                               |
| `vehicleRegistration| VarChar(100)  | NOT NULL            | Vehicle registration                               |
| `routeDescription`  | Text          | NOT NULL            | Route description                                  |
| `expectedDeliveryAt`| DateTime      | NOT NULL            | Expected delivery timestamp                         |
| `driverNameHash`    | VarChar(64)   | NOT NULL            | SHA-256 hash of driverName (sent on-chain)         |
| `driverIdHash`      | VarChar(64)   | NOT NULL            | SHA-256 hash of driverIdNumber (sent on-chain)     |
| `createdAt`         | DateTime      | @default(now())     | Record creation timestamp                          |

**Indexes**: `tradeId`

**Relations**:
- `trade` → **Trade** (1:1) — joined on `tradeId` (cascade delete)

### 3.6 TradeEvidence

**Table**: `TradeEvidence`

| Column       | Type          | Constraints         | Description                        |
|--------------|---------------|---------------------|------------------------------------|
| `id`         | Int           | PK, autoincrement   | Internal primary key               |
| `tradeId`    | VarChar(255)  | FK→Trade            | Associated trade ID                |
| `cid`        | VarChar(255)  | NOT NULL            | IPFS content identifier            |
| `filename`   | VarChar(255)  | NOT NULL            | Original filename                  |
| `mimeType`   | VarChar(100)  | NOT NULL            | MIME type of the file              |
| `uploadedBy` | VarChar(255)  | NOT NULL            | Wallet address of uploader         |
| `createdAt`  | DateTime      | @default(now())     | Upload timestamp                   |

**Indexes**: `tradeId`, `cid`

**Relations**:
- `trade` → **Trade** (1:1) — joined on `tradeId` (cascade delete)

### 3.7 ProcessedEvent

**Table**: `ProcessedEvent`

| Column           | Type          | Constraints         | Description                                |
|------------------|---------------|---------------------|--------------------------------------------|
| `id`             | Int           | PK, autoincrement   | Internal primary key                       |
| `ledgerSequence` | Int           | NOT NULL            | Stellar ledger sequence                    |
| `contractId`     | VarChar(255)  | NOT NULL            | Emitting Soroban contract ID               |
| `eventId`        | VarChar(255)  | NOT NULL            | Unique Soroban event ID                    |
| `processedAt`    | DateTime      | @default(now())     | Processing timestamp                       |

**Unique constraint**: `(ledgerSequence, contractId, eventId)`

**Purpose**: Provides durable deduplication for the event listener. Combined with the
in-memory `Set<String>` cache, it guarantees **exactly-once** event processing even
across service restarts.

### 3.8 ChainEventOutbox

**Table**: `ChainEventOutbox`

| Column           | Type                | Constraints         | Description                                    |
|------------------|---------------------|---------------------|------------------------------------------------|
| `id`             | Int                 | PK, autoincrement   | Internal primary key                           |
| `ledgerSequence` | Int                 | NOT NULL            | Stellar ledger sequence                        |
| `contractId`     | VarChar(255)        | NOT NULL            | Emitting contract ID                           |
| `eventId`        | VarChar(255)        | NOT NULL            | Unique Soroban event ID                        |
| `eventType`      | VarChar(100)        | NOT NULL            | Event type string (e.g. "TradeCreated")        |
| `tradeId`        | VarChar(255)        | NOT NULL            | Associated trade ID                            |
| `payload`        | Json                | NOT NULL            | Raw event payload data                         |
| `status`         | ChainEventSyncStatus| Default PENDING     | Processing state                               |
| `attempts`       | Int                 | Default 0           | Number of processing attempts                  |
| `nextAttemptAt`  | DateTime            | Default now()       | When the next retry is scheduled               |
| `lastError`      | Text?               | Nullable            | Error message from last failure                |
| `deadLetteredAt` | DateTime?           | Nullable            | When the event was moved to dead-letter        |
| `processedAt`    | DateTime?           | Nullable            | When the event was successfully processed      |
| `createdAt`      | DateTime            | @default(now())     | Record creation timestamp                      |
| `updatedAt`      | DateTime            | @updatedAt          | Last update timestamp                          |

**Unique constraint**: `(ledgerSequence, contractId, eventId)`
**Index**: `(status, nextAttemptAt)` — for efficient retry polling

**Purpose**: Provides a retryable outbox for event processing. Failed events are
retried with exponential backoff (default 5 max attempts). Events that exhaust
all retries are moved to `DEAD_LETTER` state for manual intervention.

### 3.9 Vault

**Table**: `Vault`

| Column        | Type          | Constraints         | Description                                 |
|---------------|---------------|---------------------|---------------------------------------------|
| `id`          | Int           | PK, autoincrement   | Internal primary key                        |
| `vaultId`     | VarChar(255)  | Unique, NOT NULL    | On-chain vault identifier                   |
| `ownerAddress`| VarChar(255)  | FK→User             | Vault owner wallet address                  |
| `balanceUsdc` | VarChar(100)  | Default "0"         | Current balance (string for precision)      |
| `createdAt`   | DateTime      | @default(now())     | Record creation timestamp                   |
| `updatedAt`   | DateTime      | @updatedAt          | Last update timestamp                       |

**Indexes**: `vaultId`, `ownerAddress`

**Relations**:
- `owner` → **User** (M:1) — joined on `ownerAddress` → `walletAddress`
- `goals` → **Goal[]** (1:N) — savings goals targeting this vault

### 3.10 Goal

**Table**: `Goal`

| Column              | Type        | Constraints         | Description                              |
|---------------------|-------------|---------------------|------------------------------------------|
| `id`                | Int         | PK, autoincrement   | Internal primary key                     |
| `goalId`            | VarChar(255)| Unique, NOT NULL    | On-chain goal identifier                 |
| `vaultId`           | VarChar(255)| FK→Vault            | Parent vault ID                          |
| `userId`            | Int         | FK→User             | Goal creator user ID                     |
| `targetAmountUsdc`  | VarChar(100)| NOT NULL            | Target amount (string for precision)     |
| `currentAmountUsdc` | VarChar(100)| Default "0"         | Current accumulated amount               |
| `deadline`          | DateTime    | NOT NULL            | Target completion date                   |
| `status`            | GoalStatus  | Default ACTIVE      | Goal lifecycle state                     |
| `createdAt`         | DateTime    | @default(now())     | Record creation timestamp                |
| `updatedAt`         | DateTime    | @updatedAt          | Last update timestamp                    |

**Indexes**: `goalId`, `vaultId`, `userId`, `status`

**Relations**:
- `vault` → **Vault** (M:1) — joined on `vaultId` (cascade delete)
- `user` → **User** (M:1) — joined on `userId` (cascade delete)

---

## 4. Trade State Machine

The `Trade.status` field follows a strict state machine enforced by the event handler
layer (`backend/src/services/eventHandlers.ts`). Only the transitions below are allowed
(see `VALID_PREDECESSORS` map); all others are silently ignored.

```
  PENDING_SIGNATURE ──► CREATED ──► FUNDED ──► DELIVERED ──► COMPLETED
                                       │
                                       ▼
                                    DISPUTED ──► COMPLETED
```

| Transition                  | Triggering Event       | Valid Predecessors       | Description                          |
|-----------------------------|------------------------|--------------------------|--------------------------------------|
| → CREATED                   | `TradeCreated`         | (none — creates record)  | Trade initialized on-chain           |
| CREATED → FUNDED            | `TradeFunded`          | CREATED                  | Buyer deposited funds                |
| FUNDED → DELIVERED          | `DeliveryConfirmed`    | FUNDED                   | Seller claims delivery               |
| DELIVERED → COMPLETED       | `FundsReleased`        | DELIVERED                | Funds released to seller             |
| FUNDED → DISPUTED           | `DisputeInitiated`     | FUNDED                   | Dispute opened by buyer/seller       |
| DISPUTED → COMPLETED        | `DisputeResolved`      | DISPUTED                 | Mediator resolved the dispute        |

**Optimistic Concurrency Control**: Each transition uses a compare-and-swap pattern:
- Verifies the current `status` and `version` match expected values
- Increments `version` on success
- Throws a concurrency conflict if another handler already moved the state

---

## 5. Canonical Timestamps

Three timestamp fields are set exactly once during the trade lifecycle and never
overwritten:

| Field          | Set When                              | Set By Event           |
|----------------|---------------------------------------|------------------------|
| `fundedAt`     | Trade transitions to FUNDED           | `TradeFunded`          |
| `deliveredAt`  | Trade transitions to DELIVERED        | `DeliveryConfirmed`    |
| `completedAt`  | Trade transitions to COMPLETED        | `FundsReleased` or     |
|                |                                       | `DisputeResolved`      |

These fields serve as single source of truth for auditing and reporting.

---

## 6. Relationship Summary

| Model              | Related Models                                     | Type     |
|--------------------|----------------------------------------------------|----------|
| **User**           | Trade (bought), Trade (sold), Dispute, Vault, Goal | 1:N      |
| **Trade**          | User (buyer/seller), Dispute, Manifest, Evidence   | N:1 / 1:1|
| **Dispute**        | Trade, User (initiator), DisputeCategory           | N:1      |
| **DisputeCategory**| Dispute                                            | 1:N      |
| **DeliveryManifest**| Trade                                              | 1:1      |
| **TradeEvidence**  | Trade                                              | N:1      |
| **ProcessedEvent** | (standalone — dedup marker)                        | —        |
| **ChainEventOutbox**| (standalone — retry queue)                        | —        |
| **Vault**          | User, Goal                                         | N:1 / 1:N|
| **Goal**           | Vault, User                                        | N:1      |

All foreign-key relationships use **cascade delete** where the child is conceptually
owned by the parent (Dispute, Manifest, Evidence, Goal). The `User`→`Trade` and
`User`→`Dispute` relations use wallet addresses as natural keys (`walletAddress`
lowercase stored in `VarChar`).
