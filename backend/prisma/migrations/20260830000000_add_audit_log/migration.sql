-- Append-only audit trail for financial operations (trade creation, fund
-- movement, dispute resolution). No update/delete paths exist in application
-- code; only the scheduled retention job prunes rows past the retention window.
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "toStatus" VARCHAR(50) NOT NULL,
    "actor" VARCHAR(255),
    "amountUsdc" VARCHAR(78),
    "ledgerSequence" INTEGER,
    "contractId" VARCHAR(255),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_tradeId_createdAt_idx" ON "AuditLog"("tradeId", "createdAt");

CREATE INDEX "AuditLog_eventType_createdAt_idx" ON "AuditLog"("eventType", "createdAt");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
