/**
 * seed.staging.ts — Reproducible synthetic data for the staging environment.
 *
 * Covers all domain models: User, Trade, Dispute, DeliveryManifest,
 * TradeEvidence, ProcessedEvent, Vault, Goal.
 *
 * Idempotent: safe to re-run; existing data is cleared first.
 *
 * Usage:
 *   DATABASE_URL=<staging-url> npx tsx prisma/seed.staging.ts
 *   (or via scripts/staging-up.sh which sets DATABASE_URL automatically)
 */

import { PrismaClient, TradeStatus, DisputeStatus, GoalStatus } from '@prisma/client';

const prisma = new PrismaClient();

// ── Synthetic Stellar wallet addresses ───────────────────────────────────────
// These are fake lowercase addresses used only in staging / testing.
const WALLETS = {
  alice:   'gbk7d7z5qhqp3m6v2x8j1n4c5r7t9w2kalice000000000000000000000000',
  bob:     'gk8e9f2g1h3i4j5k6l7m8n9o0p1q2w3ebob00000000000000000000000000',
  charlie: 'gr3t4y5u6i7o8p9a0s1d2f3g4h5j6k7lcharlie000000000000000000000',
  diana:   'gd1i2a3n4a5s6t7a8g9i0n1g2w3a4l5ldiana00000000000000000000000',
  eve:     'ge1v2e3s4t5a6g7i8n9g0w1a2l3l4e5teve000000000000000000000000000',
} as const;

async function clearAll(): Promise<void> {
  // Delete in dependency order (children before parents)
  await prisma.tradeEvidence.deleteMany({});
  await prisma.deliveryManifest.deleteMany({});
  await prisma.dispute.deleteMany({});
  await prisma.processedEvent.deleteMany({});
  await prisma.goal.deleteMany({});
  await prisma.vault.deleteMany({});
  await prisma.trade.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('  ✓ Cleared existing staging data');
}

async function seedUsers() {
  const users = await Promise.all([
    prisma.user.create({ data: { walletAddress: WALLETS.alice,   displayName: 'Alice (Buyer)' } }),
    prisma.user.create({ data: { walletAddress: WALLETS.bob,     displayName: 'Bob (Seller)' } }),
    prisma.user.create({ data: { walletAddress: WALLETS.charlie, displayName: 'Charlie (Mediator Buyer)' } }),
    prisma.user.create({ data: { walletAddress: WALLETS.diana,   displayName: 'Diana (Vault Owner)' } }),
    prisma.user.create({ data: { walletAddress: WALLETS.eve,     displayName: 'Eve (Multi-role)' } }),
  ]);
  console.log(`  ✓ Created ${users.length} users`);
  return users;
}

async function seedTrades() {
  const statuses: TradeStatus[] = [
    'PENDING_SIGNATURE',
    'CREATED',
    'FUNDED',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
  ];

  // One trade per non-disputed status
  const trades = await Promise.all(
    statuses.map((status, i) =>
      prisma.trade.create({
        data: {
          tradeId:       `staging-trade-${String(i + 1).padStart(3, '0')}`,
          buyerAddress:  WALLETS.alice,
          sellerAddress: WALLETS.bob,
          amountUsdc:    String((100 + i * 250) + '.00'),
          buyerLossBps:  5000,
          sellerLossBps: 5000,
          status,
        },
      }),
    ),
  );

  // Extra trade involving charlie/eve for breadth
  const extraTrade = await prisma.trade.create({
    data: {
      tradeId:       'staging-trade-007',
      buyerAddress:  WALLETS.charlie,
      sellerAddress: WALLETS.eve,
      amountUsdc:    '2500.00',
      buyerLossBps:  3000,
      sellerLossBps: 7000,
      status:        'FUNDED',
    },
  });

  // Disputed trade (CREATED status; dispute attached separately)
  const disputedTrade = await prisma.trade.create({
    data: {
      tradeId:       'staging-trade-008',
      buyerAddress:  WALLETS.alice,
      sellerAddress: WALLETS.eve,
      amountUsdc:    '750.00',
      buyerLossBps:  5000,
      sellerLossBps: 5000,
      status:        'DISPUTED',
    },
  });

  console.log(`  ✓ Created ${trades.length + 2} trades`);
  return { trades, extraTrade, disputedTrade };
}

async function seedDeliveryManifest(deliveredTradeId: string) {
  const manifest = await prisma.deliveryManifest.create({
    data: {
      tradeId:             deliveredTradeId,
      driverName:          'John Staging Driver',
      driverIdNumber:      'DRV-STAGING-001',
      vehicleRegistration: 'STG-001-KY',
      routeDescription:    'Lagos → Abuja via A1 expressway, depot handoff at km 320',
      expectedDeliveryAt:  new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 days
      driverNameHash:      'a'.repeat(64), // placeholder SHA-256 hex for staging
      driverIdHash:        'b'.repeat(64),
    },
  });
  console.log('  ✓ Created delivery manifest');
  return manifest;
}

async function seedTradeEvidence(tradeId: string) {
  const evidence = await Promise.all([
    prisma.tradeEvidence.create({
      data: {
        tradeId,
        cid:        'QmStagingEvidence001AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        filename:   'delivery-photo-front.jpg',
        mimeType:   'image/jpeg',
        uploadedBy: WALLETS.bob,
      },
    }),
    prisma.tradeEvidence.create({
      data: {
        tradeId,
        cid:        'QmStagingEvidence002BBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        filename:   'delivery-receipt.pdf',
        mimeType:   'application/pdf',
        uploadedBy: WALLETS.bob,
      },
    }),
  ]);
  console.log(`  ✓ Created ${evidence.length} trade evidence records`);
  return evidence;
}

async function seedDisputes(disputedTradeId: string) {
  const statuses: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];
  const [openDispute, ...rest] = await Promise.all([
    prisma.dispute.create({
      data: {
        tradeId:  disputedTradeId,
        initiator: WALLETS.alice,
        reason:   'Item delivered does not match description; grade mismatch.',
        status:   'OPEN',
      },
    }),
    // Standalone resolved disputes on completed trades — use unique dummy trade IDs
    ...statuses.slice(1).map((status, i) =>
      prisma.trade.create({
        data: {
          tradeId:       `staging-dispute-trade-${String(i + 1).padStart(3, '0')}`,
          buyerAddress:  WALLETS.charlie,
          sellerAddress: WALLETS.eve,
          amountUsdc:    '100.00',
          status:        'COMPLETED',
        },
      }).then((t) =>
        prisma.dispute.create({
          data: {
            tradeId:   t.tradeId,
            initiator: WALLETS.charlie,
            reason:    `Staging dispute scenario: ${status.toLowerCase().replace('_', ' ')}`,
            status,
            resolvedAt: status === 'RESOLVED' || status === 'CLOSED'
              ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              : null,
          },
        }),
      ),
    ),
  ]);
  console.log(`  ✓ Created ${1 + rest.length} disputes (all statuses covered)`);
  return openDispute;
}

async function seedProcessedEvents() {
  const events = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      prisma.processedEvent.create({
        data: {
          ledgerSequence: 1_000_000 + i,
          contractId:     'CSTAGING_CONTRACT_ID_PLACEHOLDER_000000000000000000000',
          eventId:        `staging-event-${String(i + 1).padStart(4, '0')}`,
        },
      }),
    ),
  );
  console.log(`  ✓ Created ${events.length} processed events`);
  return events;
}

async function seedVaultsAndGoals(userId: number) {
  const vault1 = await prisma.vault.create({
    data: {
      vaultId:      'staging-vault-001',
      ownerAddress: WALLETS.diana,
      balanceUsdc:  '5000.00',
    },
  });

  const vault2 = await prisma.vault.create({
    data: {
      vaultId:      'staging-vault-002',
      ownerAddress: WALLETS.diana,
      balanceUsdc:  '250.00',
    },
  });

  const goalStatuses: GoalStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
  const goals = await Promise.all(
    goalStatuses.map((status, i) =>
      prisma.goal.create({
        data: {
          goalId:           `staging-goal-${String(i + 1).padStart(3, '0')}`,
          vaultId:          vault1.vaultId,
          userId,
          targetAmountUsdc: String(1000 * (i + 1) + '.00'),
          currentAmountUsdc: status === 'COMPLETED' ? String(1000 * (i + 1) + '.00') : '250.00',
          deadline:          new Date(Date.now() + (30 + i * 30) * 24 * 60 * 60 * 1000),
          status,
        },
      }),
    ),
  );

  // Goal in the second vault
  await prisma.goal.create({
    data: {
      goalId:           'staging-goal-004',
      vaultId:          vault2.vaultId,
      userId,
      targetAmountUsdc: '500.00',
      currentAmountUsdc: '250.00',
      deadline:          new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      status:           'ACTIVE',
    },
  });

  console.log(`  ✓ Created 2 vaults and ${goals.length + 1} goals`);
  return { vault1, vault2, goals };
}

export async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Amana — Staging Seed');
  console.log('═══════════════════════════════════════════════════════════════');

  await clearAll();

  const users            = await seedUsers();
  const { trades, disputedTrade } = await seedTrades();

  // Delivery manifest on the DELIVERED trade (index 3)
  const deliveredTrade   = trades[3];
  await seedDeliveryManifest(deliveredTrade.tradeId);

  // Evidence on the COMPLETED trade (index 4)
  const completedTrade   = trades[4];
  await seedTradeEvidence(completedTrade.tradeId);

  await seedDisputes(disputedTrade.tradeId);
  await seedProcessedEvents();

  // Vault owner is diana (users[3])
  const diana            = users[3];
  await seedVaultsAndGoals(diana.id);

  console.log('');
  console.log('✅ Staging seed complete!');
  console.log('');
  console.log('  Summary');
  console.log('  ───────────────────────────────────────────────────────────');
  console.log('  Users     : 5  (alice, bob, charlie, diana, eve)');
  console.log('  Trades    : 10 (all statuses + disputed + extra)');
  console.log('  Disputes  : 4  (all DisputeStatus values)');
  console.log('  Manifests : 1');
  console.log('  Evidence  : 2');
  console.log('  Events    : 10 (processed events)');
  console.log('  Vaults    : 2');
  console.log('  Goals     : 4  (all GoalStatus values)');
  console.log('');
}

// Only run when executed directly, not when imported by tests
if (require.main === module) {
  main()
    .catch((e) => {
      console.error('❌ Staging seed failed:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
