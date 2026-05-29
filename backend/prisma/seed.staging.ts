/**
 * Staging seed script for Amana backend.
 *
 * Seeds all domain models with representative data covering all enum values.
 * Idempotent: deletes all records in FK-safe order before inserting.
 */

import { PrismaClient, TradeStatus, DisputeStatus, GoalStatus } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function main(): Promise<void> {
  // ── Delete in FK-safe order (children before parents) ──────────────────────
  await prisma.tradeEvidence.deleteMany();
  await prisma.deliveryManifest.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.processedEvent.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.user.deleteMany();

  // ── Users (5) ──────────────────────────────────────────────────────────────
  const users = [
    { walletAddress: 'gbuyer1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', displayName: 'Buyer One' },
    { walletAddress: 'gseller1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', displayName: 'Seller One' },
    { walletAddress: 'gbuyer2ccccccccccccccccccccccccccccccccccccccccccccccccc', displayName: 'Buyer Two' },
    { walletAddress: 'gseller2ddddddddddddddddddddddddddddddddddddddddddddddddd', displayName: 'Seller Two' },
    { walletAddress: 'gmediator1eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', displayName: 'Mediator' },
  ];
  const createdUsers = await Promise.all(users.map((u) => prisma.user.create({ data: u })));

  const [buyer1, seller1, buyer2, seller2] = createdUsers;

  // ── Trades (8, covering all 7 statuses) ────────────────────────────────────
  const tradeData = [
    { tradeId: 'trade-staging-001', buyerAddress: buyer1.walletAddress, sellerAddress: seller1.walletAddress, amountUsdc: '100.00', status: TradeStatus.PENDING_SIGNATURE, buyerLossBps: 5000, sellerLossBps: 5000 },
    { tradeId: 'trade-staging-002', buyerAddress: buyer1.walletAddress, sellerAddress: seller1.walletAddress, amountUsdc: '200.00', status: TradeStatus.CREATED, buyerLossBps: 5000, sellerLossBps: 5000 },
    { tradeId: 'trade-staging-003', buyerAddress: buyer2.walletAddress, sellerAddress: seller2.walletAddress, amountUsdc: '300.00', status: TradeStatus.FUNDED, buyerLossBps: 7000, sellerLossBps: 3000 },
    { tradeId: 'trade-staging-004', buyerAddress: buyer1.walletAddress, sellerAddress: seller2.walletAddress, amountUsdc: '150.00', status: TradeStatus.DELIVERED, buyerLossBps: 5000, sellerLossBps: 5000 },
    { tradeId: 'trade-staging-005', buyerAddress: buyer2.walletAddress, sellerAddress: seller1.walletAddress, amountUsdc: '500.00', status: TradeStatus.COMPLETED, buyerLossBps: 5000, sellerLossBps: 5000 },
    { tradeId: 'trade-staging-006', buyerAddress: buyer1.walletAddress, sellerAddress: seller1.walletAddress, amountUsdc: '75.00', status: TradeStatus.CANCELLED, buyerLossBps: 5000, sellerLossBps: 5000 },
    { tradeId: 'trade-staging-007', buyerAddress: buyer2.walletAddress, sellerAddress: seller2.walletAddress, amountUsdc: '250.00', status: TradeStatus.DISPUTED, buyerLossBps: 6000, sellerLossBps: 4000 },
    { tradeId: 'trade-staging-008', buyerAddress: buyer1.walletAddress, sellerAddress: seller2.walletAddress, amountUsdc: '400.00', status: TradeStatus.COMPLETED, buyerLossBps: 5000, sellerLossBps: 5000 },
  ];
  const createdTrades = await Promise.all(tradeData.map((t) => prisma.trade.create({ data: t })));

  // ── Disputes (4, covering all 4 statuses) ──────────────────────────────────
  const now = new Date();
  await Promise.all([
    prisma.dispute.create({ data: { tradeId: createdTrades[6].tradeId, initiator: buyer2.walletAddress, reason: 'Goods damaged in transit', status: DisputeStatus.OPEN, resolvedAt: null } }),
    prisma.dispute.create({ data: { tradeId: createdTrades[3].tradeId, initiator: buyer1.walletAddress, reason: 'Partial delivery received', status: DisputeStatus.UNDER_REVIEW, resolvedAt: null } }),
    prisma.dispute.create({ data: { tradeId: createdTrades[4].tradeId, initiator: buyer2.walletAddress, reason: 'Quality below agreed standard', status: DisputeStatus.RESOLVED, resolvedAt: now } }),
    prisma.dispute.create({ data: { tradeId: createdTrades[7].tradeId, initiator: buyer1.walletAddress, reason: 'Late delivery', status: DisputeStatus.CLOSED, resolvedAt: now } }),
  ]);

  // ── DeliveryManifest (1) ────────────────────────────────────────────────────
  await prisma.deliveryManifest.create({
    data: {
      tradeId: createdTrades[2].tradeId,
      driverNameHash: sha256('John Doe'),
      driverIdHash: sha256('DRV-12345'),
      vehicleRegistration: 'ABC-001',
      routeDescription: 'Lagos to Abuja via Lokoja',
      expectedDeliveryAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // ── TradeEvidence (2) ───────────────────────────────────────────────────────
  await Promise.all([
    prisma.tradeEvidence.create({ data: { tradeId: createdTrades[3].tradeId, cid: 'bafybeiabc123stagingdelivery', mimeType: 'video/mp4', uploadedBy: buyer1.walletAddress } }),
    prisma.tradeEvidence.create({ data: { tradeId: createdTrades[6].tradeId, cid: 'bafybeiabc456stagingdispute', mimeType: 'image/jpeg', uploadedBy: buyer2.walletAddress } }),
  ]);

  // ── ProcessedEvents (10) ────────────────────────────────────────────────────
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  for (let i = 0; i < 10; i++) {
    await prisma.processedEvent.create({
      data: {
        ledgerSequence: 1000 + i * 10,
        contractId,
        eventId: `staging-event-${String(i + 1).padStart(3, '0')}`,
        processedAt: new Date(Date.now() - (10 - i) * 60000),
      },
    });
  }

  // ── Vaults (2) ─────────────────────────────────────────────────────────────
  const vault1 = await prisma.vault.create({ data: { vaultId: 'vault-staging-001', ownerAddress: buyer1.walletAddress, balanceUsdc: '1000.00' } });
  const vault2 = await prisma.vault.create({ data: { vaultId: 'vault-staging-002', ownerAddress: buyer2.walletAddress, balanceUsdc: '2000.00' } });

  // ── Goals (4, covering all 3 statuses) ─────────────────────────────────────
  await Promise.all([
    prisma.goal.create({ data: { goalId: 'goal-staging-001', vaultId: vault1.vaultId, targetAmountUsdc: '500.00', currentAmountUsdc: '200.00', status: GoalStatus.ACTIVE } }),
    prisma.goal.create({ data: { goalId: 'goal-staging-002', vaultId: vault1.vaultId, targetAmountUsdc: '300.00', currentAmountUsdc: '300.00', status: GoalStatus.COMPLETED } }),
    prisma.goal.create({ data: { goalId: 'goal-staging-003', vaultId: vault2.vaultId, targetAmountUsdc: '1000.00', currentAmountUsdc: '750.00', status: GoalStatus.ACTIVE } }),
    prisma.goal.create({ data: { goalId: 'goal-staging-004', vaultId: vault2.vaultId, targetAmountUsdc: '200.00', currentAmountUsdc: '0.00', status: GoalStatus.CANCELLED } }),
  ]);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
