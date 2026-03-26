-- Add PENDING_SIGNATURE to TradeStatus enum if not present
ALTER TYPE "TradeStatus" ADD VALUE IF NOT EXISTS 'PENDING_SIGNATURE';

-- CreateTable DeliveryManifest
CREATE TABLE "DeliveryManifest" (
    "id" SERIAL NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "driverName" VARCHAR(255) NOT NULL,
    "driverIdNumber" VARCHAR(255) NOT NULL,
    "vehicleRegistration" VARCHAR(100) NOT NULL,
    "routeDescription" TEXT NOT NULL,
    "expectedDeliveryAt" TIMESTAMP(3) NOT NULL,
    "driverNameHash" VARCHAR(64) NOT NULL,
    "driverIdHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable TradeEvidence
CREATE TABLE "TradeEvidence" (
    "id" SERIAL NOT NULL,
    "tradeId" VARCHAR(255) NOT NULL,
    "cid" VARCHAR(255) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "uploadedBy" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryManifest_tradeId_key" ON "DeliveryManifest"("tradeId");
CREATE INDEX "DeliveryManifest_tradeId_idx" ON "DeliveryManifest"("tradeId");
CREATE INDEX "TradeEvidence_tradeId_idx" ON "TradeEvidence"("tradeId");
CREATE INDEX "TradeEvidence_cid_idx" ON "TradeEvidence"("cid");

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "Trade"("tradeId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeEvidence" ADD CONSTRAINT "TradeEvidence_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "Trade"("tradeId") ON DELETE CASCADE ON UPDATE CASCADE;
