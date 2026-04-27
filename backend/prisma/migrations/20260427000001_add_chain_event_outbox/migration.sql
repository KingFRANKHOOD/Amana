CREATE TYPE "ChainEventSyncStatus" AS ENUM ('PENDING', 'RETRYING', 'PROCESSED', 'DEAD_LETTER');

CREATE TABLE "ChainEventOutbox" (
  "id"             SERIAL PRIMARY KEY,
  "ledgerSequence" INTEGER NOT NULL,
  "contractId"     VARCHAR(255) NOT NULL,
  "eventId"        VARCHAR(255) NOT NULL,
  "eventType"      VARCHAR(100) NOT NULL,
  "tradeId"        VARCHAR(255) NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         "ChainEventSyncStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"      TEXT,
  "deadLetteredAt" TIMESTAMP(3),
  "processedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChainEventOutbox_ledgerSequence_contractId_eventId_key"
    UNIQUE ("ledgerSequence", "contractId", "eventId")
);

CREATE INDEX "ChainEventOutbox_status_nextAttemptAt_idx"
  ON "ChainEventOutbox"("status", "nextAttemptAt");

CREATE INDEX "ChainEventOutbox_ledgerSequence_idx"
  ON "ChainEventOutbox"("ledgerSequence");
