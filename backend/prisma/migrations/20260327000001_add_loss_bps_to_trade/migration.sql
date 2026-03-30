-- Add buyerLossBps and sellerLossBps columns to Trade table.
-- These store the agreed loss-sharing basis points (0–10000) for each party,
-- defaulting to 5000 (50/50) for existing rows.
ALTER TABLE "Trade"
  ADD COLUMN "buyerLossBps"  INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "sellerLossBps" INTEGER NOT NULL DEFAULT 5000;
