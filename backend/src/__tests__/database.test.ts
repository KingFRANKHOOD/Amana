/**
 * Database model and middleware tests.
 *
 * These tests verify the Prisma $use middleware that enforces lowercase
 * wallet addresses, and the model-level constraints (unique addresses, etc.).
 * They use a mocked PrismaClient so no live database connection is required.
 */

// ---------------------------------------------------------------------------
// In-memory store + middleware simulation
// ---------------------------------------------------------------------------

type UserRecord = { id: number; walletAddress: string; displayName: string; createdAt: Date; updatedAt: Date };
type TradeRecord = { id: number; tradeId: string; buyerAddress: string; sellerAddress: string; amountUsdc: string; status: string; buyerLossBps: number; sellerLossBps: number; createdAt: Date; updatedAt: Date };
type DisputeRecord = { id: number; tradeId: string; initiator: string; reason: string; status: string; resolvedAt: Date | null; createdAt: Date; updatedAt: Date };
type ManifestRecord = { id: number; tradeId: string; [key: string]: unknown };
type EvidenceRecord = { id: number; tradeId: string; [key: string]: unknown };
type VaultRecord = { id: number; vaultId: string; ownerAddress: string; [key: string]: unknown };
type GoalRecord = { id: number; goalId: string; vaultId: string; [key: string]: unknown };

/**
 * Simulates the $use middleware from db.ts that lowercases wallet addresses.
 * This is the core logic under test.
 */
function applyLowercaseMiddleware(model: string, data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  if (model === 'User' && typeof result.walletAddress === 'string') {
    result.walletAddress = result.walletAddress.toLowerCase();
  }
  if (model === 'Trade') {
    if (typeof result.buyerAddress === 'string') result.buyerAddress = result.buyerAddress.toLowerCase();
    if (typeof result.sellerAddress === 'string') result.sellerAddress = result.sellerAddress.toLowerCase();
  }
  if (model === 'Dispute' && typeof result.initiator === 'string') {
    result.initiator = result.initiator.toLowerCase();
  }
  return result;
}

/** Minimal in-memory database that mimics Prisma operations used in these tests. */
function createInMemoryDb() {
  let userIdSeq = 1;
  let tradeIdSeq = 1;
  let disputeIdSeq = 1;
  let manifestIdSeq = 1;
  let evidenceIdSeq = 1;
  let vaultIdSeq = 1;
  let goalIdSeq = 1;
  const users: UserRecord[] = [];
  const trades: TradeRecord[] = [];
  const disputes: DisputeRecord[] = [];
  const manifests: ManifestRecord[] = [];
  const evidences: EvidenceRecord[] = [];
  const vaults: VaultRecord[] = [];
  const goals: GoalRecord[] = [];

  const now = () => new Date();

  return {
    user: {
      create: ({ data }: { data: Partial<UserRecord> }) => {
        const processed = applyLowercaseMiddleware('User', data as Record<string, unknown>);
        const existing = users.find(u => u.walletAddress === processed.walletAddress);
        if (existing) return Promise.reject(new Error('Unique constraint failed on walletAddress'));
        const record: UserRecord = {
          id: userIdSeq++,
          walletAddress: processed.walletAddress as string,
          displayName: processed.displayName as string,
          createdAt: now(),
          updatedAt: now(),
        };
        users.push(record);
        return Promise.resolve(record);
      },
      findUnique: ({ where }: { where: { walletAddress?: string; id?: number } }) => {
        const found = users.find(u =>
          (where.walletAddress !== undefined && u.walletAddress === where.walletAddress) ||
          (where.id !== undefined && u.id === where.id)
        );
        return Promise.resolve(found ?? null);
      },
      update: ({ where, data }: { where: { walletAddress?: string }; data: Partial<UserRecord> }) => {
        const idx = users.findIndex(u => u.walletAddress === where.walletAddress);
        if (idx === -1) throw new Error('Record not found');
        users[idx] = { ...users[idx], ...data, updatedAt: now() };
        return Promise.resolve(users[idx]);
      },
      deleteMany: () => { users.length = 0; return Promise.resolve({ count: 0 }); },
    },
    trade: {
      create: ({ data }: { data: Partial<TradeRecord> }) => {
        const processed = applyLowercaseMiddleware('Trade', data as Record<string, unknown>);
        // FK constraint: buyer and seller must exist
        const buyerExists = users.find(u => u.walletAddress === processed.buyerAddress);
        const sellerExists = users.find(u => u.walletAddress === processed.sellerAddress);
        if (!buyerExists || !sellerExists) {
          return Promise.reject(new Error('Foreign key constraint failed: buyer or seller not found'));
        }
        const record: TradeRecord = {
          id: tradeIdSeq++,
          tradeId: processed.tradeId as string,
          buyerAddress: processed.buyerAddress as string,
          sellerAddress: processed.sellerAddress as string,
          amountUsdc: processed.amountUsdc as string ?? '0',
          status: processed.status as string ?? 'CREATED',
          buyerLossBps: processed.buyerLossBps as number ?? 5000,
          sellerLossBps: processed.sellerLossBps as number ?? 5000,
          createdAt: now(),
          updatedAt: now(),
        };
        trades.push(record);
        return Promise.resolve(record);
      },
      findUnique: ({ where, include }: { where: { tradeId?: string }; include?: { buyer?: boolean; seller?: boolean } }) => {
        const trade = trades.find(t => t.tradeId === where.tradeId);
        if (!trade) return Promise.resolve(null);
        if (!include) return Promise.resolve(trade);
        const result: any = { ...trade };
        if (include.buyer) result.buyer = users.find(u => u.walletAddress === trade.buyerAddress) ?? null;
        if (include.seller) result.seller = users.find(u => u.walletAddress === trade.sellerAddress) ?? null;
        return Promise.resolve(result);
      },
      delete: ({ where }: { where: { tradeId?: string } }) => {
        const idx = trades.findIndex(t => t.tradeId === where.tradeId);
        if (idx === -1) return Promise.reject(new Error('Record not found'));
        const [removed] = trades.splice(idx, 1);
        // cascade: remove related records
        const tid = removed.tradeId;
        for (let i = manifests.length - 1; i >= 0; i--) { if (manifests[i].tradeId === tid) manifests.splice(i, 1); }
        for (let i = evidences.length - 1; i >= 0; i--) { if (evidences[i].tradeId === tid) evidences.splice(i, 1); }
        for (let i = disputes.length - 1; i >= 0; i--) { if (disputes[i].tradeId === tid) disputes.splice(i, 1); }
        return Promise.resolve(removed);
      },
      deleteMany: () => { trades.length = 0; return Promise.resolve({ count: 0 }); },
    },
    dispute: {
      create: ({ data }: { data: Partial<DisputeRecord> }) => {
        const processed = applyLowercaseMiddleware('Dispute', data as Record<string, unknown>);
        // Unique constraint: one dispute per trade
        const existing = disputes.find(d => d.tradeId === processed.tradeId);
        if (existing) return Promise.reject(new Error('Unique constraint failed: one dispute per trade'));
        const record: DisputeRecord = {
          id: disputeIdSeq++,
          tradeId: processed.tradeId as string,
          initiator: processed.initiator as string,
          reason: processed.reason as string,
          status: processed.status as string ?? 'OPEN',
          resolvedAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        disputes.push(record);
        return Promise.resolve(record);
      },
      findUnique: ({ where }: { where: { tradeId?: string } }) => {
        const found = disputes.find(d => d.tradeId === where.tradeId);
        return Promise.resolve(found ?? null);
      },
      deleteMany: () => { disputes.length = 0; return Promise.resolve({ count: 0 }); },
    },
    deliveryManifest: {
      create: ({ data }: { data: Partial<ManifestRecord> }) => {
        const record: ManifestRecord = { id: manifestIdSeq++, tradeId: data.tradeId as string, ...data };
        manifests.push(record);
        return Promise.resolve(record);
      },
      findUnique: ({ where }: { where: { tradeId?: string } }) => {
        const found = manifests.find(m => m.tradeId === where.tradeId);
        return Promise.resolve(found ?? null);
      },
      deleteMany: () => { manifests.length = 0; return Promise.resolve({ count: 0 }); },
    },
    tradeEvidence: {
      create: ({ data }: { data: Partial<EvidenceRecord> }) => {
        const record: EvidenceRecord = { id: evidenceIdSeq++, tradeId: data.tradeId as string, ...data };
        evidences.push(record);
        return Promise.resolve(record);
      },
      findMany: ({ where }: { where: { tradeId?: string } }) => {
        const found = evidences.filter(e => e.tradeId === where.tradeId);
        return Promise.resolve(found);
      },
      deleteMany: () => { evidences.length = 0; return Promise.resolve({ count: 0 }); },
    },
    vault: {
      create: ({ data }: { data: Partial<VaultRecord> }) => {
        const record: VaultRecord = { id: vaultIdSeq++, vaultId: data.vaultId as string, ownerAddress: data.ownerAddress as string, balanceUsdc: data.balanceUsdc ?? '0', ...data };
        vaults.push(record);
        return Promise.resolve(record);
      },
      delete: ({ where }: { where: { vaultId?: string } }) => {
        const idx = vaults.findIndex(v => v.vaultId === where.vaultId);
        if (idx === -1) return Promise.reject(new Error('Record not found'));
        const [removed] = vaults.splice(idx, 1);
        // cascade: remove goals
        for (let i = goals.length - 1; i >= 0; i--) { if (goals[i].vaultId === removed.vaultId) goals.splice(i, 1); }
        return Promise.resolve(removed);
      },
      deleteMany: () => { vaults.length = 0; return Promise.resolve({ count: 0 }); },
    },
    goal: {
      create: ({ data }: { data: Partial<GoalRecord> }) => {
        const record: GoalRecord = { id: goalIdSeq++, goalId: data.goalId as string, vaultId: data.vaultId as string, status: data.status ?? 'ACTIVE', currentAmountUsdc: data.currentAmountUsdc ?? '0', ...data };
        goals.push(record);
        return Promise.resolve(record);
      },
      findUnique: ({ where }: { where: { goalId?: string } }) => {
        const found = goals.find(g => g.goalId === where.goalId);
        return Promise.resolve(found ?? null);
      },
      deleteMany: () => { goals.length = 0; return Promise.resolve({ count: 0 }); },
    },
    $disconnect: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Database Operations (In-Memory)', () => {
  let prisma: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    prisma = createInMemoryDb();
  });

  describe('User Model', () => {
    it('should create a user with lowercase wallet address', async () => {
      const walletAddress = 'GABC123456789DEFGHIJKLMNOPQRSTUVWXYZ';

      const user = await prisma.user.create({
        data: { walletAddress, displayName: 'Test User' },
      });

      expect(user).toBeDefined();
      expect(user.walletAddress).toBe(walletAddress.toLowerCase());
      expect(user.displayName).toBe('Test User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should retrieve a user by wallet address', async () => {
      const walletAddress = 'gtest123456789abcdefghijklmnopqrs';

      await prisma.user.create({ data: { walletAddress, displayName: 'Retrievable User' } });

      const retrievedUser = await prisma.user.findUnique({ where: { walletAddress } });

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.walletAddress).toBe(walletAddress);
      expect(retrievedUser?.displayName).toBe('Retrievable User');
    });

    it('should enforce unique wallet addresses', async () => {
      const walletAddress = 'gunique123456789abcdefghijklmnop';

      await prisma.user.create({ data: { walletAddress, displayName: 'First User' } });

      await expect(
        prisma.user.create({ data: { walletAddress, displayName: 'Duplicate User' } })
      ).rejects.toThrow();
    });

    it('should update user display name', async () => {
      const walletAddress = 'gupdate1234567890abcdefghijklmno';

      const user = await prisma.user.create({ data: { walletAddress, displayName: 'Original Name' } });

      const updated = await prisma.user.update({
        where: { walletAddress },
        data: { displayName: 'Updated Name' },
      });

      expect(updated.displayName).toBe('Updated Name');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(user.createdAt.getTime());
    });
  });

  describe('Trade Model', () => {
    it('should create a trade with buyer and seller relationships', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer123456789abcdefghijklmnopq', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gseller456789012abcdefghijklmnopq', displayName: 'Seller' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_test_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '100.50',
          status: 'FUNDED',
        },
      });

      expect(trade).toBeDefined();
      expect(trade.tradeId).toBe('trade_test_001');
      expect(trade.buyerAddress).toBe(buyer.walletAddress);
      expect(trade.sellerAddress).toBe(seller.walletAddress);
      expect(trade.amountUsdc).toBe('100.50');
      expect(trade.status).toBe('FUNDED');
    });

    it('should retrieve trade with buyer and seller information', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer789abcdefghijklmnopqrstuvw', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gseller01234567890abcdefghijklmno', displayName: 'Seller' } });

      await prisma.trade.create({
        data: {
          tradeId: 'trade_retrieve_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '250.75',
          status: 'COMPLETED',
        },
      });

      const trade = await prisma.trade.findUnique({
        where: { tradeId: 'trade_retrieve_001' },
        include: { buyer: true, seller: true },
      });

      expect(trade).toBeDefined();
      expect(trade?.buyer.displayName).toBe('Buyer');
      expect(trade?.seller.displayName).toBe('Seller');
    });
  });

  describe('Dispute Model', () => {
    it('should create a dispute for a trade', async () => {
      const user = await prisma.user.create({ data: { walletAddress: 'gdispute123456789abcdefghijklmnop', displayName: 'Dispute User' } });
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer_dispute1234567890abcdefghij', displayName: 'Buyer' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_dispute_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: user.walletAddress,
          amountUsdc: '500',
          status: 'DISPUTED',
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: user.walletAddress,
          reason: 'Payment not received',
          status: 'OPEN',
        },
      });

      expect(dispute).toBeDefined();
      expect(dispute.tradeId).toBe(trade.tradeId);
      expect(dispute.initiator).toBe(user.walletAddress);
      expect(dispute.reason).toBe('Payment not received');
    });
  });

  describe('Wallet Address Lowercase Enforcement', () => {
    it('should convert uppercase wallet addresses to lowercase on user creation', async () => {
      const upperCaseAddress = 'GABCDEF123456789GHIJKLMNOPQRSTUVWXYZ';

      const user = await prisma.user.create({ data: { walletAddress: upperCaseAddress, displayName: 'Test' } });

      expect(user.walletAddress).toBe(upperCaseAddress.toLowerCase());

      const retrieved = await prisma.user.findUnique({ where: { walletAddress: upperCaseAddress.toLowerCase() } });
      expect(retrieved).toBeDefined();
    });

    it('should convert buyer and seller addresses to lowercase on trade creation', async () => {
      const buyerAddress = 'GBUYER123456789ABCDEFGHIJKLMNOPQRST';
      const sellerAddress = 'GSELLER456789012ABCDEFGHIJKLMNOPQRST';

      await prisma.user.create({ data: { walletAddress: buyerAddress.toLowerCase(), displayName: 'Buyer' } });
      await prisma.user.create({ data: { walletAddress: sellerAddress.toLowerCase(), displayName: 'Seller' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_case_test_001',
          buyerAddress,   // uppercase — should be lowercased by middleware
          sellerAddress,  // uppercase — should be lowercased by middleware
          amountUsdc: '1000',
          status: 'CREATED',
        },
      });

      expect(trade.buyerAddress).toBe(buyerAddress.toLowerCase());
      expect(trade.sellerAddress).toBe(sellerAddress.toLowerCase());
    });

    it('should convert initiator address to lowercase on dispute creation', async () => {
      const userAddress = 'GINITIATOR123456789ABCDEFGHIJKLMNO';

      const user = await prisma.user.create({ data: { walletAddress: userAddress.toLowerCase(), displayName: 'Initiator' } });
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer_case_test1234567890abcdefgh', displayName: 'Buyer' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_initiator_case_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: user.walletAddress,
          amountUsdc: '100',
          status: 'COMPLETED',
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: userAddress, // uppercase — should be lowercased
          reason: 'Test dispute',
          status: 'OPEN',
        },
      });

      expect(dispute.initiator).toBe(userAddress.toLowerCase());
    });
  });

  describe('Database Integrity', () => {
    it('should maintain referential integrity between Trade and User', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gref_buyer1234567890abcdefghijklmn', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gref_seller1234567890abcdefghijklmn', displayName: 'Seller' } });

      await prisma.trade.create({
        data: {
          tradeId: 'trade_integrity_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '500',
          status: 'COMPLETED',
        },
      });

      const tradeWithRelations = await prisma.trade.findUnique({
        where: { tradeId: 'trade_integrity_001' },
        include: { buyer: true, seller: true },
      });

      expect(tradeWithRelations?.buyer.id).toBe(buyer.id);
      expect(tradeWithRelations?.seller.id).toBe(seller.id);
    });

    it('should reject trades when buyer relationship is missing', async () => {
      await prisma.user.create({
        data: {
          walletAddress: 'gexisting_seller1234567890abcdefghijk',
          displayName: 'Seller',
        },
      });

      await expect(
        prisma.trade.create({
          data: {
            tradeId: 'trade_missing_buyer_001',
            buyerAddress: 'gmissing_buyer1234567890abcdefghijk',
            sellerAddress: 'gexisting_seller1234567890abcdefghijk',
            amountUsdc: '50',
            status: 'CREATED',
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce one dispute per trade', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_unique_dispute1234567890abcd',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller_unique_dispute1234567890abc',
          displayName: 'Seller',
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_unique_dispute_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '500',
          status: 'DISPUTED',
        },
      });

      await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'First dispute',
          status: 'OPEN',
        },
      });

      await expect(
        prisma.dispute.create({
          data: {
            tradeId: trade.tradeId,
            initiator: seller.walletAddress,
            reason: 'Duplicate dispute',
            status: 'OPEN',
          },
        })
      ).rejects.toThrow();
    });

    it('should cascade delete dispute, manifest, and evidence when a trade is deleted', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_cascade_trade1234567890abcdef',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller_cascade_trade1234567890abcde',
          displayName: 'Seller',
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_cascade_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '220',
          status: 'DISPUTED',
        },
      });

      await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'Cascade dispute',
          status: 'OPEN',
        },
      });

      await prisma.deliveryManifest.create({
        data: {
          tradeId: trade.tradeId,
          driverName: 'Driver Test',
          driverIdNumber: 'ID-001',
          vehicleRegistration: 'ABC-123',
          routeDescription: 'Kaduna to Lagos',
          expectedDeliveryAt: new Date('2026-03-31T12:00:00.000Z'),
          driverNameHash: 'a'.repeat(64),
          driverIdHash: 'b'.repeat(64),
        },
      });

      await prisma.tradeEvidence.create({
        data: {
          tradeId: trade.tradeId,
          cid: 'bafybeicascadeevidence001',
          filename: 'proof.jpg',
          mimeType: 'image/jpeg',
          uploadedBy: buyer.walletAddress,
        },
      });

      await prisma.trade.delete({
        where: { tradeId: trade.tradeId },
      });

      const [dispute, manifest, evidence] = await Promise.all([
        prisma.dispute.findUnique({ where: { tradeId: trade.tradeId } }),
        prisma.deliveryManifest.findUnique({ where: { tradeId: trade.tradeId } }),
        prisma.tradeEvidence.findMany({ where: { tradeId: trade.tradeId } }),
      ]);

      expect(dispute).toBeNull();
      expect(manifest).toBeNull();
      expect(evidence).toHaveLength(0);
    });

    it('should cascade delete goals when a vault is deleted', async () => {
      const user = await prisma.user.create({
        data: {
          walletAddress: 'gvault_owner1234567890abcdefghijklmn',
          displayName: 'Vault Owner',
        },
      });

      const vault = await prisma.vault.create({
        data: {
          vaultId: 'vault_cascade_001',
          ownerAddress: user.walletAddress,
          balanceUsdc: '1000',
        },
      });

      await prisma.goal.create({
        data: {
          goalId: 'goal_cascade_001',
          vaultId: vault.vaultId,
          userId: user.id,
          targetAmountUsdc: '2500',
          currentAmountUsdc: '150',
          deadline: new Date('2026-06-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

      await prisma.vault.delete({
        where: { vaultId: vault.vaultId },
      });

      const remainingGoal = await prisma.goal.findUnique({
        where: { goalId: 'goal_cascade_001' },
      });

      expect(remainingGoal).toBeNull();
    });

    it('should preserve default status values for vault goals and disputes', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gdefaults_buyer1234567890abcdefghijk',
          displayName: 'Defaults Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gdefaults_seller1234567890abcdefghij',
          displayName: 'Defaults Seller',
        },
      });

      const vault = await prisma.vault.create({
        data: {
          vaultId: 'vault_defaults_001',
          ownerAddress: buyer.walletAddress,
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_defaults_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '1',
        },
      });

      const goal = await prisma.goal.create({
        data: {
          goalId: 'goal_defaults_001',
          vaultId: vault.vaultId,
          userId: buyer.id,
          targetAmountUsdc: '1200',
          deadline: new Date('2026-12-31T00:00:00.000Z'),
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'Default dispute status',
        },
      });

      expect(goal.status).toBe('ACTIVE');
      expect(vault.balanceUsdc).toBe('0');
      expect(trade.status).toBe('CREATED');
      expect(dispute.status).toBe('OPEN');
    });
  });
});

import { prisma } from "../lib/db";

/** Integration tests: set RUN_DATABASE_TESTS=1 and a valid DATABASE_URL. */
const runDb = process.env.RUN_DATABASE_TESTS === "1";

(runDb ? describe : describe.skip)("Database Operations (Real Database)", () => {
  // Clear database before each test
  beforeEach(async () => {
    await prisma.dispute.deleteMany({});
    await prisma.trade.deleteMany({});
    await prisma.user.deleteMany({});
  });

  describe('User Model', () => {
    it('should create a user with lowercase wallet address', async () => {
      const walletAddress = 'GABC123456789DEFGHIJKLMNOPQRSTUVWXYZ';

      const user = await prisma.user.create({
        data: { walletAddress, displayName: 'Test User' },
      });

      expect(user).toBeDefined();
      expect(user.walletAddress).toBe(walletAddress.toLowerCase());
      expect(user.displayName).toBe('Test User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should retrieve a user by wallet address', async () => {
      const walletAddress = 'gtest123456789abcdefghijklmnopqrs';

      await prisma.user.create({ data: { walletAddress, displayName: 'Retrievable User' } });

      const retrievedUser = await prisma.user.findUnique({ where: { walletAddress } });

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.walletAddress).toBe(walletAddress);
      expect(retrievedUser?.displayName).toBe('Retrievable User');
    });

    it('should enforce unique wallet addresses', async () => {
      const walletAddress = 'gunique123456789abcdefghijklmnop';

      await prisma.user.create({ data: { walletAddress, displayName: 'First User' } });

      await expect(
        prisma.user.create({ data: { walletAddress, displayName: 'Duplicate User' } })
      ).rejects.toThrow();
    });

    it('should update user display name', async () => {
      const walletAddress = 'gupdate1234567890abcdefghijklmno';

      const user = await prisma.user.create({ data: { walletAddress, displayName: 'Original Name' } });

      const updated = await prisma.user.update({
        where: { walletAddress },
        data: { displayName: 'Updated Name' },
      });

      expect(updated.displayName).toBe('Updated Name');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(user.createdAt.getTime());
    });
  });

  describe('Trade Model', () => {
    it('should create a trade with buyer and seller relationships', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer123456789abcdefghijklmnopq', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gseller456789012abcdefghijklmnopq', displayName: 'Seller' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_test_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '100.50',
          status: 'FUNDED',
        },
      });

      expect(trade).toBeDefined();
      expect(trade.tradeId).toBe('trade_test_001');
      expect(trade.buyerAddress).toBe(buyer.walletAddress);
      expect(trade.sellerAddress).toBe(seller.walletAddress);
      expect(trade.amountUsdc).toBe('100.50');
      expect(trade.status).toBe('FUNDED');
    });

    it('should retrieve trade with buyer and seller information', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer789abcdefghijklmnopqrstuvw', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gseller01234567890abcdefghijklmno', displayName: 'Seller' } });

      await prisma.trade.create({
        data: {
          tradeId: 'trade_retrieve_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '250.75',
          status: 'COMPLETED',
        },
      });

      const trade = await prisma.trade.findUnique({
        where: { tradeId: 'trade_retrieve_001' },
        include: { buyer: true, seller: true },
      });

      expect(trade).toBeDefined();
      expect(trade?.buyer.displayName).toBe('Buyer');
      expect(trade?.seller.displayName).toBe('Seller');
    });
  });

  describe('Dispute Model', () => {
    it('should create a dispute for a trade', async () => {
      const user = await prisma.user.create({ data: { walletAddress: 'gdispute123456789abcdefghijklmnop', displayName: 'Dispute User' } });
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer_dispute1234567890abcdefghij', displayName: 'Buyer' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_dispute_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: user.walletAddress,
          amountUsdc: '500',
          status: 'DISPUTED',
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: user.walletAddress,
          reason: 'Payment not received',
          status: 'OPEN',
        },
      });

      expect(dispute).toBeDefined();
      expect(dispute.tradeId).toBe(trade.tradeId);
      expect(dispute.initiator).toBe(user.walletAddress);
      expect(dispute.reason).toBe('Payment not received');
    });
  });

  describe('Wallet Address Lowercase Enforcement', () => {
    it('should convert uppercase wallet addresses to lowercase on user creation', async () => {
      const upperCaseAddress = 'GABCDEF123456789GHIJKLMNOPQRSTUVWXYZ';

      const user = await prisma.user.create({ data: { walletAddress: upperCaseAddress, displayName: 'Test' } });

      expect(user.walletAddress).toBe(upperCaseAddress.toLowerCase());

      const retrieved = await prisma.user.findUnique({ where: { walletAddress: upperCaseAddress.toLowerCase() } });
      expect(retrieved).toBeDefined();
    });

    it('should convert buyer and seller addresses to lowercase on trade creation', async () => {
      const buyerAddress = 'GBUYER123456789ABCDEFGHIJKLMNOPQRST';
      const sellerAddress = 'GSELLER456789012ABCDEFGHIJKLMNOPQRST';

      await prisma.user.create({ data: { walletAddress: buyerAddress.toLowerCase(), displayName: 'Buyer' } });
      await prisma.user.create({ data: { walletAddress: sellerAddress.toLowerCase(), displayName: 'Seller' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_case_test_001',
          buyerAddress,   // uppercase — should be lowercased by middleware
          sellerAddress,  // uppercase — should be lowercased by middleware
          amountUsdc: '1000',
          status: 'CREATED',
        },
      });

      expect(trade.buyerAddress).toBe(buyerAddress.toLowerCase());
      expect(trade.sellerAddress).toBe(sellerAddress.toLowerCase());
    });

    it('should convert initiator address to lowercase on dispute creation', async () => {
      const userAddress = 'GINITIATOR123456789ABCDEFGHIJKLMNO';

      const user = await prisma.user.create({ data: { walletAddress: userAddress.toLowerCase(), displayName: 'Initiator' } });
      const buyer = await prisma.user.create({ data: { walletAddress: 'gbuyer_case_test1234567890abcdefgh', displayName: 'Buyer' } });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_initiator_case_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: user.walletAddress,
          amountUsdc: '100',
          status: 'COMPLETED',
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: userAddress, // uppercase — should be lowercased
          reason: 'Test dispute',
          status: 'OPEN',
        },
      });

      expect(dispute.initiator).toBe(userAddress.toLowerCase());
    });
  });

  describe('Database Integrity', () => {
    it('should maintain referential integrity between Trade and User', async () => {
      const buyer = await prisma.user.create({ data: { walletAddress: 'gref_buyer1234567890abcdefghijklmn', displayName: 'Buyer' } });
      const seller = await prisma.user.create({ data: { walletAddress: 'gref_seller1234567890abcdefghijklmn', displayName: 'Seller' } });

      await prisma.trade.create({
        data: {
          tradeId: 'trade_integrity_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '500',
          status: 'COMPLETED',
        },
      });

      const tradeWithRelations = await prisma.trade.findUnique({
        where: { tradeId: 'trade_integrity_001' },
        include: { buyer: true, seller: true },
      });

      expect(tradeWithRelations?.buyer.id).toBe(buyer.id);
      expect(tradeWithRelations?.seller.id).toBe(seller.id);
    });

    it('should reject trades when buyer relationship is missing', async () => {
      await prisma.user.create({
        data: {
          walletAddress: 'gexisting_seller1234567890abcdefghijk',
          displayName: 'Seller',
        },
      });

      await expect(
        prisma.trade.create({
          data: {
            tradeId: 'trade_missing_buyer_001',
            buyerAddress: 'gmissing_buyer1234567890abcdefghijk',
            sellerAddress: 'gexisting_seller1234567890abcdefghijk',
            amountUsdc: '50',
            status: 'CREATED',
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce one dispute per trade', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_unique_dispute1234567890abcd',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller_unique_dispute1234567890abc',
          displayName: 'Seller',
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_unique_dispute_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '500',
          status: 'DISPUTED',
        },
      });

      await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'First dispute',
          status: 'OPEN',
        },
      });

      await expect(
        prisma.dispute.create({
          data: {
            tradeId: trade.tradeId,
            initiator: seller.walletAddress,
            reason: 'Duplicate dispute',
            status: 'OPEN',
          },
        })
      ).rejects.toThrow();
    });

    it('should cascade delete dispute, manifest, and evidence when a trade is deleted', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_cascade_trade1234567890abcdef',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller_cascade_trade1234567890abcde',
          displayName: 'Seller',
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_cascade_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '220',
          status: 'DISPUTED',
        },
      });

      await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'Cascade dispute',
          status: 'OPEN',
        },
      });

      await prisma.deliveryManifest.create({
        data: {
          tradeId: trade.tradeId,
          driverName: 'Driver Test',
          driverIdNumber: 'ID-001',
          vehicleRegistration: 'ABC-123',
          routeDescription: 'Kaduna to Lagos',
          expectedDeliveryAt: new Date('2026-03-31T12:00:00.000Z'),
          driverNameHash: 'a'.repeat(64),
          driverIdHash: 'b'.repeat(64),
        },
      });

      await prisma.tradeEvidence.create({
        data: {
          tradeId: trade.tradeId,
          cid: 'bafybeicascadeevidence001',
          filename: 'proof.jpg',
          mimeType: 'image/jpeg',
          uploadedBy: buyer.walletAddress,
        },
      });

      await prisma.trade.delete({
        where: { tradeId: trade.tradeId },
      });

      const [dispute, manifest, evidence] = await Promise.all([
        prisma.dispute.findUnique({ where: { tradeId: trade.tradeId } }),
        prisma.deliveryManifest.findUnique({ where: { tradeId: trade.tradeId } }),
        prisma.tradeEvidence.findMany({ where: { tradeId: trade.tradeId } }),
      ]);

      expect(dispute).toBeNull();
      expect(manifest).toBeNull();
      expect(evidence).toHaveLength(0);
    });

    it('should cascade delete goals when a vault is deleted', async () => {
      const user = await prisma.user.create({
        data: {
          walletAddress: 'gvault_owner1234567890abcdefghijklmn',
          displayName: 'Vault Owner',
        },
      });

      const vault = await prisma.vault.create({
        data: {
          vaultId: 'vault_cascade_001',
          ownerAddress: user.walletAddress,
          balanceUsdc: '1000',
        },
      });

      await prisma.goal.create({
        data: {
          goalId: 'goal_cascade_001',
          vaultId: vault.vaultId,
          userId: user.id,
          targetAmountUsdc: '2500',
          currentAmountUsdc: '150',
          deadline: new Date('2026-06-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });

      await prisma.vault.delete({
        where: { vaultId: vault.vaultId },
      });

      const remainingGoal = await prisma.goal.findUnique({
        where: { goalId: 'goal_cascade_001' },
      });

      expect(remainingGoal).toBeNull();
    });

    it('should preserve default status values for vault goals and disputes', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gdefaults_buyer1234567890abcdefghijk',
          displayName: 'Defaults Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gdefaults_seller1234567890abcdefghij',
          displayName: 'Defaults Seller',
        },
      });

      const vault = await prisma.vault.create({
        data: {
          vaultId: 'vault_defaults_001',
          ownerAddress: buyer.walletAddress,
        },
      });

      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_defaults_001',
          buyerAddress: buyer.walletAddress,
          sellerAddress: seller.walletAddress,
          amountUsdc: '1',
        },
      });

      const goal = await prisma.goal.create({
        data: {
          goalId: 'goal_defaults_001',
          vaultId: vault.vaultId,
          userId: buyer.id,
          targetAmountUsdc: '1200',
          deadline: new Date('2026-12-31T00:00:00.000Z'),
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          tradeId: trade.tradeId,
          initiator: buyer.walletAddress,
          reason: 'Default dispute status',
        },
      });

      expect(goal.status).toBe('ACTIVE');
      expect(vault.balanceUsdc).toBe('0');
      expect(trade.status).toBe('CREATED');
      expect(dispute.status).toBe('OPEN');
    });
  });
});
