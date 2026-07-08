# ADR-003: Off-chain vs. On-chain Data Partitioning

## Status

Accepted (implemented across `contracts/amana_escrow`, `backend/prisma/schema.prisma`,
and the event-sync pipeline documented in [docs/event-flow.md](../event-flow.md)
and [docs/data-model-relationships.md](../data-model-relationships.md), which
remain the detailed references for the mechanics this ADR only summarizes the
reasoning for).

## Context

Amana needs both the trustlessness of on-chain escrow (funds move only
according to contract rules, verifiable by anyone) and the practicality of
a queryable, indexable backend (list a user's trades, filter by status,
paginate, join to disputes/evidence/manifests). Putting everything on-chain
would make the contract expensive to run and impossible to query
efficiently; putting everything off-chain would make the "escrow" part of
the product just a database record someone could edit.

We needed a clear line for what belongs where, and a reliable way to keep
the off-chain copy consistent with on-chain reality without trusting
clients to report their own trade status.

## Decision

**On-chain (Soroban contract, `contracts/amana_escrow`) holds only what
must be trust-minimized:**

- The escrowed funds themselves (held by the contract, not any party or
  the backend).
- The authoritative trade status enum and the numbers that determine fund
  movement: `amount`, `buyer_loss_bps`/`seller_loss_bps`, `fee_bps` at
  resolution time, and the mediator's `seller_gets_bps` ruling.
- Nothing that's expensive to store or has no bearing on fund movement:
  no manifest text, no evidence files, no user profile data, no dispute
  reason/category text.

**Off-chain (Postgres via Prisma) holds everything queryable and
human-facing:**

- A `Trade` row **mirroring** the on-chain status/amount/participants for
  fast reads (list, filter, paginate - see
  [docs/api/trades.md](../api/trades.md#list-your-trades)), plus fields
  that have no on-chain equivalent at all: `version` (optimistic
  concurrency for the backend's own writes),
  `fundedAt`/`deliveredAt`/`completedAt` timestamps, and relations to
  `Dispute`, `DeliveryManifest`, `TradeEvidence`, `TradeNote`.
- Delivery manifests and dispute evidence - PII (driver identity,
  documents, photos/video) that has no reason to ever be on a public
  ledger, and where role-based masking (see
  [docs/api/trades.md](../api/trades.md#manifest)) only makes sense
  server-side.
- User profiles, notifications, webhooks - product features with no
  trust-minimization requirement at all.

**The off-chain `Trade` row is never the source of truth for fund
movement - it's a read-optimized mirror, kept in sync via an event-sourced
pipeline, not by trusting API callers to report their own status.** A
dedicated `EventListener` service polls Soroban RPC for contract events,
deduplicates them (in-memory `Set` for the hot path, a durable
`ProcessedEvent` table so a service restart doesn't reprocess history), and
a `ChainEventOutbox` table persists each event with retry/backoff and
dead-lettering if handling fails - see
[docs/event-flow.md](../event-flow.md) for the full pipeline. Event
handlers apply mirrored updates inside an atomic Prisma `$transaction`
guarded by `Trade.version` (optimistic concurrency), so a concurrent
handler run or an admin batch update
([docs/api/admin.md](../api/admin.md#batch-trade-status-updates)) can't
silently clobber another update.

**Contract state remains independently queryable and is not just "trust
the mirror."** `GET /contract/:contractId/state?tradeId=<id>` (see
[docs/api/stellar.md](../api/stellar.md#contract-state)) reads the Soroban
contract directly, bypassing Postgres entirely - this exists specifically
so the off-chain mirror's claim about a trade's status can be checked
against the chain when it matters (support escalations, audits, disputes
about disputes).

## Consequences

- **Positive:** Reads that matter for UX (list my trades, filter by
  status, join to dispute/evidence data) are fast Postgres queries, not
  Soroban RPC calls - the contract is never on the hot path for anything
  except the transactions that actually move funds.
- **Positive:** Sensitive data (manifest PII, evidence files, dispute
  narratives) never touches a public ledger, and role-based
  masking/hashing of that data (buyer sees masked driver identity, mediator
  sees hashed) is only possible because it's server-mediated, not
  on-chain.
- **Positive:** Because the mirror is derived from chain events rather
  than trusted client input, a compromised or buggy API client can't lie
  about a trade's status - it can only be as wrong as the event pipeline,
  which is independently auditable against
  `GET /contract/:contractId/state`.
- **Negative:** There is an inherent lag between an on-chain state change
  and its reflection in the Postgres mirror (bounded by the event
  listener's poll interval plus handler processing time) - a client that
  reads `GET /trades/:id` immediately after submitting a transaction may
  briefly see stale status. Clients needing a stronger guarantee should
  cross-check `GET /contract/:contractId/state` directly.
- **Negative:** Two representations of "trade status" (on-chain enum,
  off-chain `TradeStatus`) must be kept conceptually aligned by hand when
  either one changes - see
  [docs/data-model-relationships.md](../data-model-relationships.md) for
  the current mapping. A status added to one side without the other is a
  real failure mode the event pipeline can't protect against by itself.
