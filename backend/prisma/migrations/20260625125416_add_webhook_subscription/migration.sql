-- WebhookSubscription model for storing user webhook configurations
CREATE TABLE "WebhookSubscription" (
    "id" SERIAL NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "events" TEXT[] NOT NULL,
    "secretHash" VARCHAR(64) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_userId_idx" ON "WebhookSubscription"("userId");
CREATE INDEX "WebhookSubscription_isActive_idx" ON "WebhookSubscription"("isActive");

ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
