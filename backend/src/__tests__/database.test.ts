import { prisma } from "../lib/db";

/** Integration tests: set RUN_DATABASE_TESTS=1 and a valid DATABASE_URL. */
const runDb = process.env.RUN_DATABASE_TESTS === "1";

(runDb ? describe : describe.skip)("Database Operations", () => {
  // Clear database before each test
  beforeEach(async () => {
    await prisma.dispute.deleteMany({});
    await prisma.trade.deleteMany({});
    await prisma.user.deleteMany({});
  });

  // Disconnect after all tests
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('User Model', () => {
    it('should create a user with lowercase wallet address', async () => {
      const walletAddress = 'GABC123456789DEFGHIJKLMNOPQRSTUVWXYZ';
      
      const user = await prisma.user.create({
        data: {
          walletAddress: walletAddress,
          displayName: 'Test User',
        },
      });

      expect(user).toBeDefined();
      expect(user.walletAddress).toBe(walletAddress.toLowerCase());
      expect(user.displayName).toBe('Test User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should retrieve a user by wallet address', async () => {
      const walletAddress = 'gtest123456789abcdefghijklmnopqrs';
      
      await prisma.user.create({
        data: {
          walletAddress,
          displayName: 'Retrievable User',
        },
      });

      const retrievedUser = await prisma.user.findUnique({
        where: { walletAddress },
      });

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.walletAddress).toBe(walletAddress);
      expect(retrievedUser?.displayName).toBe('Retrievable User');
    });

    it('should enforce unique wallet addresses', async () => {
      const walletAddress = 'gunique123456789abcdefghijklmnop';

      await prisma.user.create({
        data: {
          walletAddress,
          displayName: 'First User',
        },
      });

      await expect(
        prisma.user.create({
          data: {
            walletAddress,
            displayName: 'Duplicate User',
          },
        })
      ).rejects.toThrow();
    });

    it('should update user display name', async () => {
      const walletAddress = 'gupdate1234567890abcdefghijklmno';
      
      const user = await prisma.user.create({
        data: {
          walletAddress,
          displayName: 'Original Name',
        },
      });

      const updated = await prisma.user.update({
        where: { walletAddress },
        data: { displayName: 'Updated Name' },
      });

      expect(updated.displayName).toBe('Updated Name');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(user.createdAt.getTime());
    });
  });

  describe('Trade Model', () => {
    it('should create a trade with buyer and seller relationships', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer123456789abcdefghijklmnopq',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller456789012abcdefghijklmnopq',
          displayName: 'Seller',
        },
      });

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
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer789abcdefghijklmnopqrstuvw',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gseller01234567890abcdefghijklmno',
          displayName: 'Seller',
        },
      });

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
        include: {
          buyer: true,
          seller: true,
        },
      });

      expect(trade).toBeDefined();
      expect(trade?.buyer.displayName).toBe('Buyer');
      expect(trade?.seller.displayName).toBe('Seller');
    });
  });

  describe('Dispute Model', () => {
    it('should create a dispute for a trade', async () => {
      const user = await prisma.user.create({
        data: {
          walletAddress: 'gdispute123456789abcdefghijklmnop',
          displayName: 'Dispute User',
        },
      });

      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_dispute1234567890abcdefghij',
          displayName: 'Buyer',
        },
      });

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

      const user = await prisma.user.create({
        data: {
          walletAddress: upperCaseAddress,
          displayName: 'Test',
        },
      });

      expect(user.walletAddress).toBe(upperCaseAddress.toLowerCase());

      const retrieved = await prisma.user.findUnique({
        where: { walletAddress: upperCaseAddress.toLowerCase() },
      });

      expect(retrieved).toBeDefined();
    });

    it('should convert buyer and seller addresses to lowercase on trade creation', async () => {
      const buyerAddress = 'GBUYER123456789ABCDEFGHIJKLMNOPQRST';
      const sellerAddress = 'GSELLER456789012ABCDEFGHIJKLMNOPQRST';

      // Create users with lowercase addresses
      await prisma.user.create({
        data: {
          walletAddress: buyerAddress.toLowerCase(),
          displayName: 'Buyer',
        },
      });

      await prisma.user.create({
        data: {
          walletAddress: sellerAddress.toLowerCase(),
          displayName: 'Seller',
        },
      });

      // Create trade with uppercase addresses (should be converted to lowercase)
      const trade = await prisma.trade.create({
        data: {
          tradeId: 'trade_case_test_001',
          buyerAddress: buyerAddress,
          sellerAddress: sellerAddress,
          amountUsdc: '1000',
          status: 'CREATED',
        },
      });

      expect(trade.buyerAddress).toBe(buyerAddress.toLowerCase());
      expect(trade.sellerAddress).toBe(sellerAddress.toLowerCase());
    });

    it('should convert initiator address to lowercase on dispute creation', async () => {
      const userAddress = 'GINITIATOR123456789ABCDEFGHIJKLMNO';

      const user = await prisma.user.create({
        data: {
          walletAddress: userAddress.toLowerCase(),
          displayName: 'Initiator',
        },
      });

      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gbuyer_case_test1234567890abcdefgh',
          displayName: 'Buyer',
        },
      });

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
          initiator: userAddress, // Uppercase
          reason: 'Test dispute',
          status: 'OPEN',
        },
      });

      expect(dispute.initiator).toBe(userAddress.toLowerCase());
    });
  });

  describe('Database Integrity', () => {
    it('should maintain referential integrity between Trade and User', async () => {
      const buyer = await prisma.user.create({
        data: {
          walletAddress: 'gref_buyer1234567890abcdefghijklmn',
          displayName: 'Buyer',
        },
      });

      const seller = await prisma.user.create({
        data: {
          walletAddress: 'gref_seller1234567890abcdefghijklmn',
          displayName: 'Seller',
        },
      });

      const trade = await prisma.trade.create({
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
        include: {
          buyer: true,
          seller: true,
        },
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
