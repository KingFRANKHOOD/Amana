-- WebhookDeadLetter model for storing permanently failed webhook deliveries
CREATE TABLE "WebhookDeadLetter" (
    "id" SERIAL NOT NULL,
    "webhookUrl" VARCHAR(2048) NOT NULL,
    "subscriptionId" INTEGER,
    "secretHash" VARCHAR(64),
    "event" VARCHAR(100) NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50),
    "payload" JSONB NOT NULL,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deadLetteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeadLetter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDeadLetter_webhookUrl_deadLetteredAt_idx" ON "WebhookDeadLetter"("webhookUrl", "deadLetteredAt");
CREATE INDEX "WebhookDeadLetter_tradeId_idx" ON "WebhookDeadLetter"("tradeId");
