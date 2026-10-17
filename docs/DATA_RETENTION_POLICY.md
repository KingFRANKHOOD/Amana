# Amana Comprehensive Data Retention & Lifecycle Management Policy

## 1. Executive Summary & Purpose

Amana is a decentralized escrow and cross-border settlement platform built on the Stellar network and Soroban smart contracts. This Data Retention and Lifecycle Management Policy defines the mandatory retention periods, automated cleanup workflows, cold archival architecture, and regulatory compliance controls governing all data collected, processed, and stored across Amana backend systems, databases, distributed caches, and IPFS storage.

### Core Objectives
1. **Regulatory Compliance**: Satisfy statutory financial recordkeeping obligations (FINRA 4511, IRS 7-year transaction retention) while enforcing privacy principles (GDPR Storage Limitation, CCPA/CPRA, SOC 2 Type II CC6.5 data disposal).
2. **Storage Optimization & Cost Containment**: Prevent unbounded database and cache growth through scheduled automated background cleanup jobs and structured cold data archival.
3. **Data Minimization & Privacy Protection**: Automatically redact raw Personally Identifiable Information (PII) from delivery manifests and purge expired ephemeral credentials.
4. **Forensic Integrity & Auditability**: Maintain cryptographically verifiable archives and immutable audit logs with SHA-256 integrity verification.
5. **Continuous Observability**: Track table growth, database volume, and cleanup throughput via Prometheus metrics and Grafana dashboards.

---

## 2. Regulatory & Legal Compliance Framework

| Regulatory Framework | Mandatory Requirement | Amana Policy Enforcement |
|---|---|---|
| **GDPR Art. 5(1)(e)** (Storage Limitation) | Personal data must not be kept in an identifiable form for longer than necessary. | Driver PII in `DeliveryManifest` is automatically masked/redacted after 30 days (`MANIFEST_PII_RETENTION_DAYS`). Read notifications pruned at 30 days. |
| **GDPR Art. 17** (Right to Erasure) | Data subjects have the right to request deletion of personal data when no overriding statutory obligation applies. | Expired refresh tokens, in-app notifications, and encrypted trade notes are purged via automated retention workers (`DataRetentionService`). |
| **GDPR Art. 32** (Security of Processing) | Ensure confidentiality, integrity, availability, and resilience of processing systems. | AES-256-GCM encryption for trade notes; Gzip compression with SHA-256 checksums for cold archives; tamper-evident Ed25519 audit trails. |
| **FINRA Rule 4511 / IRS 26 U.S. Code § 6001** | Financial transaction records and settlement histories must be preserved for at least 7 years. | Completed `Trade`, `AuditLog`, `PlatformFeeEvent`, and `EscrowReleaseMilestone` records retained for 7 years (2,555 days) before cold archival or disposal. |
| **SOC 2 Type II (CC6.1, CC6.5)** | Implement logical access controls and secure data sanitization and disposal procedures. | Scheduled automated retention cron jobs (`data-retention-cleanup.worker.ts`) execute non-reversible bulk prunes and record metrics. |
| **CCPA / CPRA (Cal. Civ. Code § 1798.100)** | Disclose retention periods per category of personal information collected. | Comprehensive taxonomy published in Section 3 with explicit retention windows. |

---

## 3. Data Classification Taxonomy & Retention Matrix

The table below defines the retention period, trigger event, storage location, archival strategy, and disposal method for every data model in the Amana platform:

| Data Category | Entity / Table | Classification | Retention Period | Trigger Event | Storage Tier | Archival Strategy | Disposal / Sanitization Method | Legal Basis |
|---|---|---|---|---|---|---|---|---|
| **Financial Transactions** | `Trade`, `EscrowReleaseMilestone`, `PlatformFeeEvent` | Restricted / Financial | **7 Years** (2,555 days) | Trade transitioned to `COMPLETED` or `CANCELLED` | PostgreSQL Hot Tier &rarr; Cold Archive (at 180 days) | Compressed JSON.gz with SHA-256 checksum in `./data/archives/trades` | Permanent deletion after 7 years upon statutory expiry | Statutory Compliance (FINRA, IRS § 6001) |
| **Financial Audit Logs** | `AuditLog` | Restricted / Audit | **7 Years** (2,555 days) | Record insertion via `AuditLogService` | PostgreSQL Hot Tier | Batch archive export prior to scheduled purge | Automated bulk deletion via `AuditLogService.pruneExpired()` | Regulatory Requirement |
| **Dispute Records** | `Dispute`, `DisputeCategory` | Confidential | **7 Years** (2,555 days) | Dispute status set to `RESOLVED` or `CLOSED` | PostgreSQL Hot Tier | Linked to parent trade cold archive bundle | Cascading deletion with parent trade record | Contract Performance & Legal Defense |
| **Delivery Manifest PII** | `DeliveryManifest` (Raw Driver Name, ID Number, Route) | Confidential / PII | **30 Days** (`MANIFEST_PII_RETENTION_DAYS`) | Manifest created & trade funded | PostgreSQL Hot Tier | On-chain SHA-256 hash remains permanently immutable | In-place field redaction: `driverName` & `driverIdNumber` set to `[REDACTED]` | GDPR Art. 5(1)(e) Storage Limitation |
| **Delivery Evidence Metadata** | `TradeEvidence` | Confidential | **90 Days** (`EVIDENCE_METADATA_RETENTION_DAYS`) | Evidence uploaded | PostgreSQL Hot Tier | Archive manifest metadata | Metadata redaction / unpinning from Pinata IPFS gateway | Contractual Performance |
| **Private Trade Notes** | `TradeNote` | Confidential (AES-256-GCM) | **90 Days** (`TRADE_NOTE_RETENTION_DAYS`) | Trade completed / cancelled | PostgreSQL Hot Tier | N/A (Ephemeral private notes) | Hard delete via `pruneExpiredTradeNotes()` | User Privacy & Data Minimization |
| **User Identity & Multi-Wallets** | `User`, `UserWallet`, `NotificationPreference` | Internal | **Active + 7 Years** | Account closure or explicit deletion request | PostgreSQL Hot Tier | Exported to user compliance archive | Cryptographic anonymization of wallet mappings | Contractual & AML / KYC |
| **Auth & Session Tokens** | `RefreshToken` | Confidential | **7 Days** post-expiration (`REFRESH_TOKEN_RETENTION_DAYS`) | Token `expiresAt` timestamp reached | PostgreSQL Hot Tier | None | Automated hard delete via `pruneExpiredRefreshTokens()` | Security & Session Hygiene (SOC 2) |
| **In-App Notifications (Read)** | `InAppNotification` (`isRead: true`) | Internal | **30 Days** (`NOTIFICATION_READ_RETENTION_DAYS`) | Notification marked as read | PostgreSQL Hot Tier | None | Automated hard delete via `pruneExpiredNotifications()` | Operational Hygiene |
| **In-App Notifications (Unread)** | `InAppNotification` (`isRead: false`) | Internal | **90 Days** (`NOTIFICATION_UNREAD_RETENTION_DAYS`) | Notification created | PostgreSQL Hot Tier | None | Automated hard delete via `pruneExpiredNotifications()` | Operational Hygiene |
| **Webhook Delivery Attempts** | `WebhookDeliveryAttempt` | Operational | **14 Days** (`WEBHOOK_DELIVERY_RETENTION_DAYS`) | Webhook execution attempt timestamp | PostgreSQL Hot Tier | None | Automated hard delete via `pruneExpiredWebhookDeliveryAttempts()` | System Operations (SOC 2) |
| **Chain Deduplication Logs** | `ProcessedEvent` | Operational | **30 Days** (`PROCESSED_EVENT_RETENTION_DAYS`) | Ledger event processed timestamp | PostgreSQL Hot Tier | None | Hard delete past 30 days (ledger history safe on Stellar) | System Operations |
| **Event Ingestion Outbox** | `ChainEventOutbox` | Operational | **14 Days** (PROCESSED) / **90 Days** (DEAD_LETTER) | Event status transition | PostgreSQL Hot Tier | Dead-letter payloads logged to Loki | Automated hard delete via `pruneExpiredChainEventOutbox()` | Reliability & Error Recovery |
| **Indexed Event Cache** | `IndexedEvent` | Operational | **90 Days** (`INDEXED_EVENT_RETENTION_DAYS`) | Ingested timestamp | PostgreSQL Hot Tier | Hot cache pruned (raw ledger verifiable on Horizon) | Automated hard delete via `pruneExpiredIndexedEvents()` | Cache Size Optimization |
| **Redis Ephemeral Storage** | `idempotency:*`, cache keys, rate limits | Ephemeral | **24 Hours** (Idempotency) / **60 Seconds** (Stats) | Key insertion | Redis In-Memory | None | Redis native TTL expiry + daily GC worker (`idempotency-cleanup.worker.ts`) | Cache Performance |

---

## 4. Automated Cleanup & Archival Architecture

```
                               ┌────────────────────────────────────────────────────────┐
                               │               Amana Scheduled Retention Workers        │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                               ┌──────────────────────────┴─────────────────────────────┐
                               │                                                        │
                 Daily Cron (02:00 UTC)                                  Weekly Cron (Sun 03:30 UTC)
                 data-retention-cleanup                                         data-archival
                               │                                                        │
        ┌──────────────────────┴──────────────────────┐                                 │
        │                                             │                                 │
  Prune Expired:                               Redact PII:                              │
  • RefreshToken (>7d expired)                 • DeliveryManifest (>30d)               │
  • InAppNotification (Read >30d, Unread >90d)   [driverName -> REDACTED]               │
  • WebhookDeliveryAttempt (>14d)              • TradeNote (>90d completed)             │
  • ProcessedEvent (>30d)                                                               │
  • ChainEventOutbox (Proc >14d, Dead >90d)                                             ▼
  • IndexedEvent (>90d)                                                 Archive Cold Trades (>180d):
  • AuditLog (>7 years)                                                 1. Extract Trade + Relations
        │                                                               2. Build JSON Archive Bundle
        ▼                                                               3. Compute SHA-256 Checksum
  Emit Prometheus Metrics:                                              4. Compress with Gzip (.json.gz)
  • data_retention_records_pruned_total                                 5. Write Metadata Manifest (.meta.json)
  • data_retention_cleanup_duration_ms                                  6. Emit data_archival_records_total
```

### 4.1 Scheduled Workers & Queues
- **`data-retention-cleanup` Worker** (`backend/src/jobs/workers/data-retention-cleanup.worker.ts`):
  - Scheduled via BullMQ repeatable job at **02:00 UTC daily** (`0 2 * * *`).
  - Executes batch queries across all models with transaction isolation.
  - Automatically emits Prometheus counters for each pruned category.
- **`data-archival` Worker** (`backend/src/jobs/workers/data-archival.worker.ts`):
  - Scheduled via BullMQ repeatable job at **03:30 UTC every Sunday** (`30 3 * * 0`).
  - Finds closed trades (`COMPLETED` or `CANCELLED`) older than `TRADE_ARCHIVAL_THRESHOLD_DAYS` (default 180 days).
  - Serializes trades, disputes, manifests, evidence metadata, and milestone schedules into compressed JSON archives.
- **`idempotency-cleanup` Worker** (`backend/src/jobs/workers/idempotency-cleanup.worker.ts`):
  - Scheduled daily at **03:00 UTC** (`0 3 * * *`).
  - Cleans legacy unexpired idempotency keys from Redis.
- **`audit-log-retention` Worker** (`backend/src/jobs/workers/audit-log-retention.worker.ts`):
  - Scheduled daily at **04:00 UTC** (`0 4 * * *`).
  - Prunes statutory audit logs past `AUDIT_LOG_RETENTION_DAYS` (7 years).

### 4.2 On-Demand Admin Execution API
Authorized administrators can trigger and verify retention operations via REST endpoints:

- `GET /api/v1/admin/retention/policy` — Inspect current policy configuration and last run summary.
- `POST /api/v1/admin/retention/cleanup` — Trigger immediate cleanup pass (supports `?async=true` for queueing).
- `GET /api/v1/admin/retention/archives` — List all archived bundles with SHA-256 integrity metadata.
- `POST /api/v1/admin/retention/archives/run` — Manually execute cold trade archival.
- `GET /api/v1/admin/retention/archives/:id/verify` — Verify cryptographic SHA-256 integrity of an archive bundle.
- `GET /api/v1/admin/retention/storage` — Retrieve database table sizes, row counts, and disk usage snapshot.

---

## 5. Cold Storage Archival & Integrity Verification

### 5.1 Archive File Format
Archives are stored in `ARCHIVE_STORAGE_PATH` (default: `./data/archives`) organized by entity type:
```
data/archives/
├── trades/
│   ├── trades_1756560000000_a1b2c3d4.json.gz     # Gzip-compressed archive payload
│   └── trades_1756560000000_a1b2c3d4.meta.json    # SHA-256 manifest metadata
└── audit_logs/
    ├── audit_1756560000000_e5f6a7b8.json.gz
    └── audit_1756560000000_e5f6a7b8.meta.json
```

### 5.2 Archive Metadata Schema (`.meta.json`)
```json
{
  "archiveId": "trades_1756560000000_a1b2c3d4",
  "entityType": "trades",
  "generatedAt": "2026-08-30T03:30:00.000Z",
  "recordCount": 450,
  "dateRange": {
    "from": "2026-01-01T00:00:00.000Z",
    "to": "2026-03-01T00:00:00.000Z"
  },
  "checksumSha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "compressed": true,
  "filePath": "/var/data/archives/trades/trades_1756560000000_a1b2c3d4.json.gz"
}
```

### 5.3 Integrity Verification Process
1. Read `.meta.json` to extract `checksumSha256` and `recordCount`.
2. Read `.json.gz` from storage and decompress via `zlib.gunzipSync`.
3. Compute SHA-256 hash over the raw uncompressed JSON.
4. Compare computed hash against metadata checksum.
5. If hashes match: archive is verified as authentic and untampered. If mismatched: flag as corrupted and alert operations.

---

## 6. Storage Growth Monitoring & Capacity Alerting

### 6.1 Prometheus Metrics Exported
The backend continuously exposes storage metrics via `GET /metrics`:

| Metric Name | Type | Description | Labels |
|---|---|---|---|
| `storage_database_size_bytes` | Gauge | Total PostgreSQL database size on disk | None |
| `storage_table_size_bytes` | Gauge | PostgreSQL table size including indexes | `table` |
| `storage_table_row_count` | Gauge | Estimated number of live rows in table | `table` |
| `data_retention_records_pruned_total` | Counter | Total records pruned by retention jobs | `entity_type` |
| `data_archival_records_archived_total` | Counter | Total records moved to cold storage | `entity_type` |

### 6.2 Storage Alerting Thresholds

| Alert Rule | Condition | Severity | Action Required |
|---|---|---|---|
| `DatabaseStorageWarning` | `storage_database_size_bytes > 50GB` | P2 (Medium) | Review archival schedules; verify retention jobs are running daily. |
| `DatabaseStorageCritical` | `storage_database_size_bytes > 80GB` | P1 (High) | Scale RDS storage volume; execute on-demand archival for cold tables. |
| `RetentionJobFailing` | `increase(data_retention_records_pruned_total[48h]) == 0` | P2 (Medium) | Check BullMQ worker logs for `data-retention-cleanup` job failures. |
| `TableUnboundedGrowth` | `rate(storage_table_size_bytes[7d]) > 5GB/day` | P2 (Medium) | Analyze table insertion rate; review index bloat and VACUUM schedules. |

---

## 7. Policy Governance & Legal Hold Procedures

### 7.1 Legal Hold Exception Policy
If Amana receives a formal regulatory inquiry, subpoena, or active litigation notice involving specific trades, wallets, or users:
1. The Compliance Officer flags the affected `tradeId` or `walletAddress` under a **Legal Hold**.
2. Automated retention pruning and archival routines are suspended specifically for records tagged under legal hold.
3. Once legal proceedings conclude, the hold is formally released, and standard retention periods resume.

### 7.2 Annual Policy Review
This policy is reviewed annually by the Engineering Lead, Security Officer, and Compliance Lead. Changes to statutory regulations or data architectures require an immediate policy revision and PR review.
