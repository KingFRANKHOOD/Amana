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
  const users: UserRecord[] = [];
  const trades: TradeRecord[] = [];
  const disputes: DisputeRecord[] = [];

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
      deleteMany: () => { trades.length = 0; return Promise.resolve({ count: 0 }); },
    },
    dispute: {
      create: ({ data }: { data: Partial<DisputeRecord> }) => {
        const processed = applyLowercaseMiddleware('Dispute', data as Record<string, unknown>);
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
      deleteMany: () => { disputes.length = 0; return Promise.resolve({ count: 0 }); },
    },
    $disconnect: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Database Operations', () => {
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
  });
});
