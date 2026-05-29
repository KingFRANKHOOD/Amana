# Event Flow

This document describes the end-to-end flow of on-chain Soroban contract events into
the Amana backend, including how they are polled, parsed, deduplicated, handled, and
dispatched to external webhooks.

---

## 1. Architecture Overview

```
  ┌──────────────────┐
  │  Stellar Network  │  ◄── User sends transaction
  │  (Soroban RPC)    │
  └────────┬─────────┘
           │ poll (getEvents)
           ▼
  ┌──────────────────┐
  │ EventListener    │  Recursive setTimeout loop
  │ Service          │  In-memory Set for fast dedup
  │                  │  DB-backed ProcessedEvent for durable dedup
  │                  │  ChainEventOutbox for retry persistence
  └────────┬─────────┘
           │ dispatchEvent()
           ▼
  ┌──────────────────┐
  │  Event Handlers  │  handleTradeCreated / handleTradeFunded / etc.
  │                  │  Atomic Prisma $transaction
  │                  │  Optimistic concurrency (version field)
  └────────┬─────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  ┌──────┐  ┌──────────┐
  │  DB  │  │ Webhook  │  HTTP POST with HMAC-SHA256 signature
  │      │  │ Service  │  trade.{status} event format
  └──────┘  └──────────┘
```

### Key Files

| Layer | File |
|-------|------|
| Config | `backend/src/config/eventListener.config.ts` |
| Types | `backend/src/types/events.ts` |
| Listener | `backend/src/services/eventListener.service.ts` |
| Handlers | `backend/src/services/eventHandlers.ts` |
| Webhooks | `backend/src/services/webhook.service.ts` |
| Dedup model | `prisma/schema.prisma` → `ProcessedEvent` |
| Outbox model | `prisma/schema.prisma` → `ChainEventOutbox` |
| Startup | `backend/src/index.ts` |

---

## 2. Smart Contract Events

The Soroban contract (`contracts/amana_escrow/src/lib.rs`) emits 14 event types.
The backend listens for the 6 **status-transition** events below. Other events
(EvidenceSubmitted, VideoProofSubmitted, ManifestSubmitted, etc.) are recorded on-chain
but not currently handled by the backend event listener.

| # | Event (contract)              | Topic Symbol | Backend EventType       | Resulting TradeStatus |
|---|-------------------------------|--------------|-------------------------|-----------------------|
| 1 | `TradeCreatedEvent`           | `TRDCRT`     | `TradeCreated`          | CREATED               |
| 2 | `TradeFundedEvent`            | `TRDFND`     | `TradeFunded`           | FUNDED                |
| 3 | `DeliveryConfirmedEvent`      | `DELCNF`     | `DeliveryConfirmed`     | DELIVERED             |
| 4 | `FundsReleasedEvent`          | `RELSD`      | `FundsReleased`         | COMPLETED             |
| 5 | `DisputeInitiatedEvent`       | `DISINI`     | `DisputeInitiated`      | DISPUTED              |
| 6 | `DisputeResolvedEvent`        | `DISRES`     | `DisputeResolved`       | COMPLETED             |

Non-status events (not consumed by the backend listener):
- `TradeCancelledEvent` (`TRDCAN`)
- `EvidenceSubmittedEvent` (`EVDSUB`)
- `VideoProofSubmittedEvent` (`VIDPRF`)
- `ManifestSubmittedEvent` (`MNFST`)
- `MediatorAddedEvent` (`MEDADD`)
- `MediatorRemovedEvent` (`MEDREM`)
- `InitializedEvent`

---

## 3. Event Listener Service

### 3.1 Lifecycle

The `EventListenerService` is created in `backend/src/index.ts` and started after the
Express app initializes. It runs as a background polling loop for the lifetime of the
process.

```
App boot ──► Create EventListenerService ──► service.start()
                                                  │
                                                  ▼
                                          Hydrate in-memory cache
                                          (last N processed ledgers from DB)
                                                  │
                                                  ▼
                                          Schedule first poll
```

On graceful shutdown (`SIGTERM`/`SIGINT`), `service.stop()` is called to clear the
timeout.

### 3.2 Polling Loop

The loop uses **recursive `setTimeout`** (not `setInterval`) to prevent overlapping
polls. Each cycle:

```
  1. Call server.getEvents({
       startLedger: lastLedger + 1,
       filters: [{ type: "contract", contractIds: [contractId] }],
       limit: 100
     })
  2. For each raw event in response:
       a. Parse XDR → ParsedEvent (parseEvent)
       b. Check in-memory Set (fast path)
       c. Check ProcessedEvent DB table (durable path)
       d. Process via outbox or atomic transaction
  3. On success:
       - Reset backoff to initial value
       - Schedule next poll at pollIntervalMs
  4. On RPC failure:
       - Apply exponential backoff with jitter
       - Schedule retry at backoff delay
```

### 3.3 Parsing

Raw Soroban events arrive as `StellarSdk.rpc.Api.EventResponse` objects. The
`parseEvent()` method extracts:

- **eventType**: Mapped from the first topic element via `mapSymbolToEventType()`
  (supports both PascalCase and snake_case symbols, e.g. `TradeCreated` or
  `trade_created`)
- **tradeId**: Extracted from the second topic element
- **ledgerSequence**: From `rawEvent.ledger`
- **contractId**: From `rawEvent.contractId` or config default
- **eventId**: From `rawEvent.id`
- **data**: Parsed map entries from the XDR event value

### 3.4 Event Dispatch

A parsed event is dispatched via:

```
dispatchEvent(tx, parsedEvent) ──► handlers[eventType](tx, parsedEvent)
```

The handler registry:

| EventType             | Handler                  |
|-----------------------|--------------------------|
| `TradeCreated`        | `handleTradeCreated`     |
| `TradeFunded`         | `handleTradeFunded`      |
| `DeliveryConfirmed`   | `handleDeliveryConfirmed`|
| `FundsReleased`       | `handleFundsReleased`    |
| `DisputeInitiated`    | `handleDisputeInitiated` |
| `DisputeResolved`     | `handleDisputeResolved`  |

---

## 4. Exactly-Once Processing

The event listener guarantees **exactly-once** semantics through a two-layer
deduplication strategy:

```
Incoming Event
      │
      ▼
┌─────────────────────┐
│ In-Memory Set       │  Fast path — O(1) lookup
│ cacheKey =           │  Hydrated from DB on startup
│ "{ledger}:{ctr}:{id}"│  LRU-evicted at capacity limit
└─────────┬───────────┘
     ┌────┴────┐
     │  Hit?   │── Yes ──► Skip
     └────┬────┘
          │ No
          ▼
┌──────────────────────┐
│ DB ProcessedEvent    │  Durable path — survives restarts
│ findUnique({          │  Unique on (ledgerSequence, contractId, eventId)
│   ledgerSequence,     │
│   contractId,         │
│   eventId             │
│ })                    │
└──────────┬───────────┘
     ┌─────┴─────┐
     │ Exists?   │── Yes ──► Add to in-memory cache, skip
     └─────┬─────┘
           │ No
           ▼
┌──────────────────────┐
│ Atomic Transaction   │  Prisma $transaction wrapping:
│                       │   1. handler(tx, event) — DB mutations
│                       │   2. processedEvent.create(...) — dedup marker
│                       │  Both succeed or both roll back
└──────────────────────┘
```

### Cache Hydration

On startup, the service loads the most recent `processedLedgersCacheSize` (default
10,000) `ProcessedEvent` records into the in-memory `Set`. This prevents re-processing
events that were handled before a restart.

### In-Memory Eviction

When the in-memory set exceeds `processedLedgersCacheSize`, the oldest entries (by
ledger sequence) are evicted. The DB record remains as the durable source of truth.

---

## 5. ChainEventOutbox (Retry & Dead-Letter)

When outbox persistence is available (the `ChainEventOutbox` model exists), the event
listener uses an outbox pattern for resilient processing:

### 5.1 Processing Flow with Outbox

```
  1. ensureOutboxRecord(event)
     - Upserts a ChainEventOutbox row with status = PENDING
     - Unique on (ledgerSequence, contractId, eventId)

  2. isOutboxReadyForAttempt(outbox)
     - Skips if status is PROCESSED or DEAD_LETTER
     - Skips if nextAttemptAt is in the future

  3. processOutboxEventAtomically(outboxId, event)
     - Prisma $transaction:
       a. handler(tx, event) — business logic
       b. processedEvent.create(...) — dedup marker
       c. chainEventOutbox.update(...) → PROCESSED status

  4. On failure:
     - recordOutboxFailure(outbox, error)
     - Increments attempts counter
     - If attempts < maxAttempts: status = RETRYING,
       nextAttemptAt = now + exponential_backoff(attempts)
     - If attempts >= maxAttempts: status = DEAD_LETTER,
       deadLetteredAt = now
```

### 5.2 Retry Schedule

| Attempt | Delay (default config: initial=1s, max=30s) |
|---------|---------------------------------------------|
| 1       | ~1s (initial backoff + random jitter)       |
| 2       | ~2s                                         |
| 3       | ~4s                                         |
| 4       | ~8s                                         |
| 5       | ~16s                                        |
| 6       | Dead-letter (no more retries)               |

Default max attempts: **5** (configurable via `EVENT_OUTBOX_MAX_ATTEMPTS`).

### 5.3 Outbox Status State Machine

```
  PENDING ──► RETRYING ──► PROCESSED
                │
                ▼
            DEAD_LETTER
```

### 5.4 Dead-Letter Recovery

Events in `DEAD_LETTER` state require manual intervention. The `lastError` field
contains the error message for debugging. After the root cause is fixed, an operator
can reset the status to `PENDING` or `RETRYING` to re-attempt processing.

---

## 6. Event Handlers — Business Logic

### 6.1 `handleTradeCreated`

```typescript
async function handleTradeCreated(tx, event)
```

1. Extracts `buyer`, `seller`, `amount_usdc` from `event.data`
2. Calls `applyStatusTransition()` which:
   - Checks if a `Trade` record exists for `event.tradeId`
   - If **not found**: creates a new `Trade` record with `status = CREATED`, `version = 1`
   - If **found**: validates the current status is a valid predecessor (for
     `TradeCreated`, no predecessor check since the event creates the record)
3. Dispatches webhook: `trade.created`

### 6.2 `handleTradeFunded`

```typescript
async function handleTradeFunded(tx, event)
```

1. Calls `applyStatusTransition()`:
   - Validates current status is `CREATED` (see `VALID_PREDECESSORS`)
   - Updates trade to `status = FUNDED`, increments `version`
   - Sets `fundedAt` canonical timestamp
2. Dispatches webhook: `trade.funded`
3. Logs payment authorization approval

### 6.3 `handleDeliveryConfirmed`

```typescript
async function handleDeliveryConfirmed(tx, event)
```

1. Calls `applyStatusTransition()`:
   - Validates current status is `FUNDED`
   - Updates trade to `status = DELIVERED`, increments `version`
   - Sets `deliveredAt` canonical timestamp
2. Dispatches webhook: `trade.delivered`

### 6.4 `handleFundsReleased`

```typescript
async function handleFundsReleased(tx, event)
```

1. Calls `applyStatusTransition()`:
   - Validates current status is `DELIVERED`
   - Updates trade to `status = COMPLETED`, increments `version`
   - Sets `completedAt` canonical timestamp
2. Dispatches webhook: `trade.completed`

### 6.5 `handleDisputeInitiated`

```typescript
async function handleDisputeInitiated(tx, event)
```

1. Calls `applyStatusTransition()`:
   - Validates current status is `FUNDED`
   - Updates trade to `status = DISPUTED`, increments `version`
2. Dispatches webhook: `trade.disputed`

### 6.6 `handleDisputeResolved`

```typescript
async function handleDisputeResolved(tx, event)
```

1. Calls `applyStatusTransition()`:
   - Validates current status is `DISPUTED`
   - Updates trade to `status = COMPLETED`, increments `version`
   - Sets `completedAt` canonical timestamp
2. Dispatches webhook: `trade.completed`

---

## 7. `applyStatusTransition` — Core State Machine

This function implements the optimistic concurrency control for all status transitions:

```
1. Find existing Trade by tradeId
2. If not found: create Trade record (only for TradeCreated)
3. If found:
   a. Check VALID_PREDECESSORS[eventType] includes current status
      - If invalid: silently return (idempotent no-op)
   b. updateMany({
        where: {
          tradeId,
          status: currentStatus,     // CAS on status
          version: currentVersion     // CAS on version
        },
        data: {
          status: newStatus,
          version: { increment: 1 },  // monotonic counter
          updatedAt: new Date()
        }
      })
   c. If result.count === 0: throw "Concurrency conflict"
      (another handler already moved the state)
```

This pattern ensures:
- **Idempotency**: Replaying an already-applied event is a no-op
- **Linearizability**: Concurrent handlers for the same trade cannot race
- **Ordering**: Events applied out-of-order are ignored by predecessor validation

---

## 8. Webhook Dispatch

After each successful status transition, the `WebhookService` sends an HTTP POST to
the configured webhook URL (`WEBHOOK_URL` env var).

### Payload Format

```json
{
  "event": "trade.created",
  "tradeId": "12345",
  "status": "CREATED",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "data": {
    "ledger": 123456
  }
}
```

### Security

- If `WEBHOOK_SECRET` is configured, the payload is signed with **HMAC-SHA256**
- The signature is sent in the `X-Webhook-Signature` header
- Receivers can verify the signature using the shared secret

### Error Handling

- Non-OK responses are logged as warnings
- Network/protocol errors are logged as errors
- Webhook failures do **not** block event processing or roll back the DB transaction
- The webhook is fire-and-forget; no retry mechanism is built in (re-delivery would
  require replaying on-chain events)

---

## 9. Configuration Reference

All event listener configuration is in `backend/src/config/eventListener.config.ts`,
overridable via environment variables.

| Variable                     | Default                              | Description                              |
|------------------------------|--------------------------------------|------------------------------------------|
| `STELLAR_RPC_URL`            | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint                     |
| `CONTRACT_ID`                | `""`                                 | Target Soroban contract ID               |
| `EVENT_POLL_INTERVAL_MS`     | `10000`                              | Polling interval in milliseconds         |
| `BACKOFF_INITIAL_MS`         | `1000`                               | Initial RPC backoff delay                |
| `BACKOFF_MAX_MS`             | `30000`                              | Maximum RPC backoff delay                |
| `PROCESSED_LEDGERS_CACHE_SIZE`| `10000`                             | In-memory dedup cache capacity           |
| `EVENT_OUTBOX_MAX_ATTEMPTS`  | `5`                                  | Outbox retry limit before dead-letter    |
| `WEBHOOK_URL`                | (none)                               | Webhook destination URL                  |
| `WEBHOOK_SECRET`             | (none)                               | HMAC-SHA256 signing key                  |

---

## 10. Testing

| Test File | Description | Lines |
|-----------|-------------|-------|
| `backend/src/__tests__/events.integration.test.ts` | End-to-end event emission & consumption | 984 |
| `backend/src/__tests__/eventHandlers.test.ts` | Unit tests for each event handler | 262 |
| `backend/src/__tests__/eventListener.test.ts` | EventListenerService poll/parse/dispatch | 625 |
| `backend/src/__tests__/eventListener.outbox.test.ts` | Outbox retry & dead-letter behavior | 170 |
| `backend/src/__tests__/eventListener.idempotency.test.ts` | Exactly-once dedup semantics | 511 |
| `backend/src/__tests__/event.ingestion.test.ts` | Event ingestion pipeline | — |
| `contracts/amana_escrow/tests/event_emission_tests.rs` | Contract-level event emission validation | 469 |
| `contracts/amana_escrow/src/tests/event_schema_tests.rs` | Unit-level event schema validation | — |
