-- Add missing indexes for performance optimization
-- These indexes were identified during schema review to improve query performance

-- Index on Trade.version for optimistic concurrency queries
CREATE INDEX IF NOT EXISTS "Trade_version_idx" ON "Trade"("version");

-- Index on Dispute.version for optimistic concurrency queries
CREATE INDEX IF NOT EXISTS "Dispute_version_idx" ON "Dispute"("version");

-- Index on Trade.fundedAt for time-based queries
CREATE INDEX IF NOT EXISTS "Trade_fundedAt_idx" ON "Trade"("fundedAt");

-- Index on Trade.deliveredAt for time-based queries
CREATE INDEX IF NOT EXISTS "Trade_deliveredAt_idx" ON "Trade"("deliveredAt");

-- Index on Trade.completedAt for time-based queries
CREATE INDEX IF NOT EXISTS "Trade_completedAt_idx" ON "Trade"("completedAt");

-- Index on Dispute.resolvedAt for time-based queries
CREATE INDEX IF NOT EXISTS "Dispute_resolvedAt_idx" ON "Dispute"("resolvedAt");

-- Index on ChainEventOutbox.eventType for filtering by event type
CREATE INDEX IF NOT EXISTS "ChainEventOutbox_eventType_idx" ON "ChainEventOutbox"("eventType");

-- Index on ChainEventOutbox.tradeId for joining with Trade table
CREATE INDEX IF NOT EXISTS "ChainEventOutbox_tradeId_idx" ON "ChainEventOutbox"("tradeId");

-- Index on ChainEventOutbox.attempts for monitoring retry behavior
CREATE INDEX IF NOT EXISTS "ChainEventOutbox_attempts_idx" ON "ChainEventOutbox"("attempts");

-- Index on DeliveryManifest.expectedDeliveryAt for time-based queries
CREATE INDEX IF NOT EXISTS "DeliveryManifest_expectedDeliveryAt_idx" ON "DeliveryManifest"("expectedDeliveryAt");

-- Index on TradeEvidence.uploadedBy for user-specific evidence queries
CREATE INDEX IF NOT EXISTS "TradeEvidence_uploadedBy_idx" ON "TradeEvidence"("uploadedBy");

-- Index on Goal.deadline for time-based goal queries
CREATE INDEX IF NOT EXISTS "Goal_deadline_idx" ON "Goal"("deadline");

-- Composite index on User.createdAt for user registration analytics
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");

-- Composite index on Trade.status and createdAt for status-based time queries
CREATE INDEX IF NOT EXISTS "Trade_status_createdAt_idx" ON "Trade"("status", "createdAt");

-- Composite index on Dispute.status and createdAt for dispute analytics
CREATE INDEX IF NOT EXISTS "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
