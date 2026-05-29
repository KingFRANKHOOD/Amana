-- Add optimistic concurrency version counter to Dispute for race-safe status transitions.
ALTER TABLE "Dispute"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
