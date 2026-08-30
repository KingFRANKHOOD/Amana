# Audit Trail for Financial Operations

This document describes what is audited, where it is stored, who can read
it, and how long it is retained.

## What is logged

Every financial-state-changing operation writes an append-only row to the
`AuditLog` table, in the same database transaction as the state change it
documents:

| Event                         | Source                                                        |
|--------------------------------|----------------------------------------------------------------|
| Trade creation requested (off-chain, pre-signature) | `TradeService.createPendingTrade` |
| Trade created (on-chain confirmation)  | `eventHandlers.handleTradeCreated` |
| Trade funded                   | `eventHandlers.handleTradeFunded` |
| Delivery confirmed             | `eventHandlers.handleDeliveryConfirmed` |
| Funds released (+ platform fee)| `eventHandlers.handleFundsReleased` |
| Dispute initiated              | `eventHandlers.handleDisputeInitiated` |
| Dispute resolved on-chain (+ platform fee) | `eventHandlers.handleDisputeResolved` |
| Dispute status transition by a mediator (off-chain) | `DisputeService.transitionDisputeStatus` |

Each row records: `tradeId`, `eventType`, `toStatus`, `actor` (wallet
address, when known), `amountUsdc`, `ledgerSequence`, `contractId`, and a
free-form `metadata` JSON blob for event-specific context.

On-chain transitions additionally emit a structured `appLogger.info({audit:
true, ...})` line, so log aggregators can alert on audit events
independently of the database.

## Append-only guarantee

`AuditLogService` exposes only `record()` (insert) and `list()` (read).
There is no `update` method, and the only `delete` path is
`pruneExpired()`, which is invoked exclusively by the scheduled retention
worker — never from request-handling code. Application code has no way to
mutate or remove an individual row once written.

## Audit dashboard

`GET /api/v1/admin/audit-logs` — admin-only, rate-limited, paginated and
filterable by `tradeId`, `eventType`, `dateFrom`/`dateTo`. Backs an admin
audit dashboard UI; returns raw rows plus pagination metadata suitable for
building compliance/fraud-review views.

## Retention policy

Audit rows are retained for `AUDIT_LOG_RETENTION_DAYS` (default: 2555 days
/ 7 years, matching typical financial record-keeping requirements) before
being pruned by the `audit-log-retention` BullMQ worker, which runs daily
at 04:00 UTC (`src/jobs/workers/audit-log-retention.worker.ts`). Adjust the
window via the `AUDIT_LOG_RETENTION_DAYS` environment variable.

## Adding a new financial operation

When adding a new financial-state-changing operation:

1. Perform the state change inside a `prisma.$transaction`.
2. Call `auditLogService.record(tx, { tradeId, eventType, toStatus, ... })`
   inside the same transaction (or `logEscrowEvent(tx, ctx)` if the
   operation is an on-chain event-handler transition, which also emits the
   structured log line).
3. Do not add update/delete methods to `AuditLogService` — the audit trail
   must remain append-only.
