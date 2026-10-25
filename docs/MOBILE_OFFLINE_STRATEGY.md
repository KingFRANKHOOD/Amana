# Amana Mobile Offline Strategy, Sync Architecture & Conflict Resolution

## 1. Executive Summary & Architecture Philosophy

Amana's mobile application is built with a **Local-First, Offline-First Architecture** designed specifically for agricultural supply chains, cross-border traders, truck drivers, and cooperative managers who routinely operate in rural markets, transport corridors, and border regions with intermittent 2G/3G connectivity or complete network blackouts.

### Core Architecture Principles:
1. **Zero-Block Local Reads**: Users can browse active trades, view delivery manifests, inspect dispute statuses, and verify milestone schedules entirely from local SQLite storage without network latency or blocking loading spinners.
2. **Optimistic Mutation Queueing**: When offline, write actions (e.g. creating trade agreements, capturing delivery proof, submitting disputes) are validated locally against Zod schemas and committed to an SQLite transactional outbox queue (`offline_queue`).
3. **Multi-Trigger Background Synchronization**: Queued operations are automatically synchronized upon network reconnection via four independent trigger pipelines (foreground app activation, reactive network listener, 15-minute background OS fetch, and manual user refresh).
4. **Deterministic Conflict Resolution & Idempotency**: All mutations carry client-generated idempotency keys and undergo server-authoritative state reconciliation to eliminate duplicate transactions and prevent split-brain state.
5. **Transparent Visual Indicators**: Live banners, badge counters, and a dedicated `SyncQueueScreen` keep users continuously informed of connectivity status, pending sync counts, and any actionable errors.

---

## 2. Mobile Storage Architecture & Security Tiering

```
                                ┌────────────────────────────────────────────────────────┐
                                │                   Amana Mobile App                     │
                                └──────────────────────────┬─────────────────────────────┘
                                                           │
                      ┌────────────────────────────────────┼────────────────────────────────────┐
                      │                                    │                                    │
                      ▼                                    ▼                                    ▼
       ┌──────────────────────────────┐     ┌──────────────────────────────┐     ┌──────────────────────────────┐
       │     Secure Storage Tier      │     │    Relational SQLite Tier    │     │     Reactive Memory Tier     │
       │     (expo-secure-store)      │     │      (expo-sqlite DB)        │     │       (Zustand Stores)       │
       └──────────────┬───────────────┘     └──────────────┬───────────────┘     └──────────────┬───────────────┘
                      │                                    │                                    │
             • JWT Access / Refresh               • `trades` Table                      • `authStore`
             • Wallet Seed Signers                • `offline_queue` Table               • `tradeStore`
             • Biometric Auth Token               • Cached Manifests                    • Live UI State
```

### 2.1 Storage Tiers

| Storage Tier | Technology | Contents | Persistence & Security |
|---|---|---|---|
| **Secure Storage Tier** | `expo-secure-store` | JWT tokens, refresh tokens, user wallet addresses, biometric session secrets. | Hardware-backed encryption (iOS Keychain / Android KeyStore). Cleared on logout. |
| **Relational Database Tier** | `expo-sqlite` (`amana_offline.db`) | Cached trade entities, milestone data, delivery manifests, and queued outbound actions. | Sandboxed SQLite database persisted across app restarts. |
| **Reactive Memory Tier** | Zustand (`tradeStore.ts`, `authStore.ts`) | In-memory reactive state powering React components. | Synchronized with SQLite cache on launch and background sync. |

### 2.2 Database Schema (`amana_offline.db`)

```sql
-- Cached Trade Records (Fast local lookup & filtering)
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,          -- JSON-encoded Trade entity
  updated_at INTEGER NOT NULL  -- Epoch timestamp for Last-Write-Wins sorting
);

-- Outbound Action Queue (Transactional outbox for offline mutations)
CREATE TABLE IF NOT EXISTS offline_queue (
  id TEXT PRIMARY KEY,          -- Client UUID / timestamp ID
  type TEXT NOT NULL,        -- 'CREATE_TRADE' | 'SUBMIT_EVIDENCE' | 'INITIATE_DISPUTE'
  payload TEXT NOT NULL,     -- JSON-encoded mutation arguments
  created_at TEXT NOT NULL,  -- ISO timestamp
  status TEXT NOT NULL,      -- 'pending' | 'processing' | 'failed'
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT            -- Last encountered error message for user inspection
);

CREATE INDEX IF NOT EXISTS offline_queue_status_created_idx
  ON offline_queue(status, created_at);
```

---

## 3. Synchronization Mechanism & Lifecycle Triggers

```
                         ┌────────────────────────────────────────────────────────┐
                         │               Synchronization Triggers                 │
                         └──────────────────────────┬─────────────────────────────┘
                                                    │
         ┌───────────────────┬──────────────────────┼──────────────────────┬───────────────────┐
         │                   │                      │                      │                   │
         ▼                   ▼                      ▼                      ▼                   ▼
   App Foreground       Network Active       Background Fetch       Manual Trigger      Pull-to-Refresh
   (AppState change)   (Network Listener)   (Every 15 min OS)     (SyncQueue Screen)   (TradeList Screen)
         │                   │                      │                      │                   │
         └───────────────────┴──────────────────────┼──────────────────────┴───────────────────┘
                                                    │
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │    Network Available Check    │
                                    │  (Network.getNetworkState())  │
                                    └───────────────┬───────────────┘
                                                    │
                                         [Online = true]
                                                    │
                                                    ▼
                                    ┌───────────────────────────────┐
                                    │  offlineQueue.process() Loop  │
                                    └───────────────┬───────────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                              [Sync Success]                  [Sync Failure]
                                    │                               │
                                    ▼                               ▼
                       • Execute API Call              • Increment retry_count
                       • Delete from offline_queue     • Set status = 'failed'
                       • Update local SQLite cache     • Record last_error in DB
                       • Push Success Notification     • Push Error Notification
```

### 3.1 Synchronization Triggers
1. **App Foregrounding** (`offlineService.setupForegroundSync`):
   - Whenever the app transitions from background to `active`, the system verifies network state and synchronizes fresh trade lists.
2. **Reactive Network Polling / Event Listener** (`offlineQueue.startNetworkListener`):
   - Monitors device network state every 15 seconds. When transitions from offline to online are detected, it immediately initiates `offlineQueue.process()`.
3. **Background Fetch OS Task** (`expo-background-fetch` + `expo-task-manager`):
   - Registers background task `amana-offline-queue-sync` with `minimumInterval: 15 * 60` (15 minutes).
   - Syncs drafts in the background even if the app is minimized.
4. **Manual User Sync** (`SyncQueueScreen` & `TradeListScreen`):
   - Users can tap the "Sync" button in the queue header or swipe down to pull-to-refresh on the trade feed.

---

## 4. Conflict Resolution Strategy & Invariant Protection

When multiple clients modify state or actions are queued while disconnected, conflicts are resolved through a deterministic hierarchy:

```
                               ┌────────────────────────────────────────────────────────┐
                               │              Conflict Resolution Hierarchy             │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                       1. Pre-Enqueue Invariant Validation (Client-side Zod validation)
                                                          │
                       2. Cryptographic Idempotency Keys (Deduplication on backend)
                                                          │
                       3. Optimistic Concurrency Control (Version & Timestamp validation)
                                                          │
                       4. Server-Authoritative State Reconciliation (Ledger truth overwrites cache)
                                                          │
                       5. Non-Blocking Fault Isolation & User Mediation (SyncQueue retry/edit)
```

### 4.1 Client-Side Invariant Validation (Pre-Enqueue)
Before any action is committed to `offline_queue`, the mobile client executes strict validation:
- Example: `createTradePayloadSchema` validates that `buyerLossBps + sellerLossBps === 10000` (100%), valid Stellar public keys, and positive USDC amounts.
- Prevents invalid or malformed drafts from entering the queue.

### 4.2 Idempotency Keys & Duplicate Prevention
- Every queued draft generates a unique client-side UUID `id` (e.g. `1756560000000-a1b2c3`).
- When submitted to `POST /api/v1/trades`, the backend checks its Redis idempotency cache. If a transient network drop caused a retry of an already-created trade, the backend safely returns the existing record without creating duplicate escrow contracts.

### 4.3 Server-Authoritative State Reconciliation
- The Stellar blockchain ledger and backend PostgreSQL database are the **single source of truth**.
- When `tradeApi.listTrades()` or `syncTrades()` completes, the client overwrites its local SQLite `trades` table with the latest authoritative server payloads, resolving any stale local cached state.

### 4.4 Non-Blocking Fault Isolation
- If action #1 in the queue fails (e.g. seller wallet not found or insufficient funds), action #2 (a different valid trade) is **not blocked**.
- Failed items transition to `status = 'failed'` with the exact server error message saved to `last_error`.
- The user can open `SyncQueueScreen`, review the error message, tap **Retry**, or tap **Delete** to discard.

---

## 5. UI Indicators & User Experience

Amana mobile provides rich, contextual visual cues so users always know their network and sync state:

### 5.1 `OfflineBanner` Component (`mobile/src/components/OfflineBanner.tsx`)
Rendered globally at the top of the trade list and primary screens:
- **Offline Active** (`#FEF3C7` Amber):
  > 📡 **Offline Mode Active** — Actions are securely queued and will sync once connected. `[Queue (2)]`
- **Syncing In Progress** (`#DBEAFE` Blue):
  > 🔄 **Syncing offline drafts...** — Drafts will upload automatically. `[Queue (2)]`
- **Sync Failed** (`#FEE2E2` Red):
  > ⚠️ **1 draft failed to sync** — Tap to review and retry failed actions. `[Queue (1)]`
- **Pending Sync** (`#ECFDF5` Mint):
  > 📦 **2 drafts pending sync** — Drafts will upload automatically. `[Queue (2)]`

### 5.2 Header Sync Badge (`TradeListScreen.tsx`)
- Shows a high-contrast badge `Pending (N)` in the top navigation bar when un-synced items exist, allowing 1-tap navigation to the queue.

### 5.3 Sync Queue Management Screen (`SyncQueueScreen.tsx`)
- Displays all queued drafts with:
  - Action type badge (`CREATE TRADE`, `SUBMIT EVIDENCE`, `INITIATE DISPUTE`).
  - Current status (`PENDING`, `PROCESSING`, `FAILED`).
  - Detailed error messages on failure.
  - Interactive **Retry** and **Delete** buttons.
  - Top **Sync Now** button for manual forced sync.

---

## 6. Testing & Offline Verification

The offline architecture is covered by automated unit and scenario tests in `mobile/src/services/__tests__/offline-strategy.test.ts` and `offline.service.test.ts`:

### Test Coverage Scenarios:
1. **Offline Enqueueing**: Verifies valid drafts are persisted to SQLite with `status: 'pending'` and invalid schemas are rejected.
2. **Network Offline Hold**: Verifies no network requests are attempted while `isOnline === false`.
3. **Automatic Sync on Reconnect**: Verifies `process()` executes all pending items, deletes synced rows, and triggers local user notifications.
4. **Error Handling & Retry Loop**: Simulates API timeouts; verifies items transition to `failed`, record error details, and recover upon manual retry.
5. **Queue Deletion**: Verifies users can remove drafts from the queue cleanly.
6. **Local Cache Fallback**: Verifies SQLite serves cached trade records seamlessly during network dropouts.
