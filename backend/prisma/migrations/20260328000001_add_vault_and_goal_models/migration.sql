-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Vault" (
    "id" SERIAL NOT NULL,
    "vaultId" VARCHAR(255) NOT NULL,
    "ownerAddress" VARCHAR(255) NOT NULL,
    "balanceUsdc" VARCHAR(100) NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" SERIAL NOT NULL,
    "goalId" VARCHAR(255) NOT NULL,
    "vaultId" VARCHAR(255) NOT NULL,
    "userId" INTEGER NOT NULL,
    "targetAmountUsdc" VARCHAR(100) NOT NULL,
    "currentAmountUsdc" VARCHAR(100) NOT NULL DEFAULT '0',
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vault_vaultId_key" ON "Vault"("vaultId");

-- CreateIndex
CREATE INDEX "Vault_vaultId_idx" ON "Vault"("vaultId");

-- CreateIndex
CREATE INDEX "Vault_ownerAddress_idx" ON "Vault"("ownerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_goalId_key" ON "Goal"("goalId");

-- CreateIndex
CREATE INDEX "Goal_goalId_idx" ON "Goal"("goalId");

-- CreateIndex
CREATE INDEX "Goal_vaultId_idx" ON "Goal"("vaultId");

-- CreateIndex
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");

-- CreateIndex
CREATE INDEX "Goal_status_idx" ON "Goal"("status");

-- AddForeignKey
ALTER TABLE "Vault" ADD CONSTRAINT "Vault_ownerAddress_fkey" FOREIGN KEY ("ownerAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("vaultId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
