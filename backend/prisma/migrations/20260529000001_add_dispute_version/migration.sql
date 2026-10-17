-- Add optimistic concurrency version counter to Dispute for race-safe status transitions.
ALTER TABLE "Dispute"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Add optimistic concurrency version counter to Trade.
-- schema.prisma declares Trade.version Int @default(0), and
-- 20260529000002_add_missing_indexes creates "Trade_version_idx" on this column,
-- but no migration ever added it. Use IF NOT EXISTS so this is safe if the
-- column already exists in an existing database (e.g. applied via db push).
ALTER TABLE "Trade"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
