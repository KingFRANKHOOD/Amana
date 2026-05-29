-- AUDIT-001: Add canonical status-transition timestamps to Trade.
-- These columns are set once at the moment of each status transition and
-- never overwritten, giving the audit trail a durable, immutable source of
-- truth that is independent of the mutable updatedAt field.

ALTER TABLE "Trade"
  ADD COLUMN "fundedAt"    TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);
