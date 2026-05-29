-- CreateTable
CREATE TABLE "DisputeCategory" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeCategory_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN "categoryId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCategory_name_key" ON "DisputeCategory"("name");

-- CreateIndex
CREATE INDEX "DisputeCategory_name_idx" ON "DisputeCategory"("name");

-- CreateIndex
CREATE INDEX "DisputeCategory_isActive_idx" ON "DisputeCategory"("isActive");

-- CreateIndex
CREATE INDEX "Dispute_categoryId_idx" ON "Dispute"("categoryId");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DisputeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default active categories so dispute creation can be validated immediately.
INSERT INTO "DisputeCategory" ("name", "description", "isActive", "createdAt", "updatedAt")
VALUES
    ('DAMAGE', 'Goods arrived damaged or unusable.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('DELIVERY_DELAY', 'Delivery was late or did not arrive.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ITEM_MISMATCH', 'Delivered goods did not match the agreed trade.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('PAYMENT', 'Funding, payment, or settlement issue.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('OTHER', 'Dispute does not fit another active category.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
