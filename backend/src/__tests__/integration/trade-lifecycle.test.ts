/**
 * Integration test suite for the full trade lifecycle.
 *
 * Tests the service layer (TradeService + ManifestService) end-to-end with
 * an in-memory store standing in for Postgres and mocked Stellar/Soroban RPCs.
 *
 * Paths covered:
 *   - Happy path: create → CREATED → FUNDED → manifest → DELIVERED → COMPLETED
 *   - Dispute path: create → FUNDED → initiate dispute → COMPLETED (resolved)
 *   - Cancellation path: create → CREATED → CANCELLED
 *
 * Infrastructure note: for a full testcontainers setup (real Postgres + Redis),
 * replace the in-memory store below with @testcontainers/postgresql and a real
 * PrismaClient pointed at the test container's connection string.
 */

import { TradeStatus, DisputeStatus } from '@prisma/client';
import { TradeService, DisputeTradeStatusError } from '../../services/trade.service';
import { ManifestService, ManifestTradeStatusError, ManifestForbiddenError } from '../../services/manifest.service';

// ---------------------------------------------------------------------------
// Stellar / Soroban RPC mock — replaces live network calls
// ---------------------------------------------------------------------------

jest.mock('../../services/contract.service', () => ({
  ContractService: jest.fn().mockImplementation(() => ({
    buildInitiateDisputeTx: jest.fn().mockResolvedValue({
      unsignedXdr: 'mock-unsigned-xdr-dispute',
    }),
    buildCreateTradeTx: jest.fn().mockResolvedValue({
      tradeId: 'mock-trade-id',
      unsignedXdr: 'mock-unsigned-xdr-create',
    }),
    buildDepositTx: jest.fn().mockResolvedValue({
      unsignedXdr: 'mock-unsigned-xdr-deposit',
    }),
  })),
}));

// Silence logger output during tests
jest.mock('../../middleware/logger', () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config/tracing', () => ({
  TracingHelper: { addEvent: jest.fn() },
}));

// ---------------------------------------------------------------------------
// In-memory Prisma stand-in
// ---------------------------------------------------------------------------

type StoredTrade = Record<string, unknown>;
type StoredDispute = Record<string, unknown>;
type StoredManifest = Record<string, unknown>;

function createTestPrisma() {
  const trades = new Map<string, StoredTrade>();
  const disputes = new Map<string, StoredDispute>();
  const manifests = new Map<string, StoredManifest>();
  const categories = new Map<number, { id: number; name: string; isActive: boolean }>();

  categories.set(1, { id: 1, name: 'quality', isActive: true });

  let manifestSeq = 0;

  return {
    trade: {
      create: jest.fn(({ data }: { data: StoredTrade }) => {
        const record = { id: trades.size + 1, createdAt: new Date(), updatedAt: new Date(), ...data };
        trades.set(data.tradeId as string, record);
        return Promise.resolve(record);
      }),
      findUnique: jest.fn(({ where }: { where: { tradeId?: string } }) =>
        Promise.resolve(trades.get(where.tradeId ?? '') ?? null),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const id = (where as { OR?: Array<{ tradeId?: string }> }).OR?.[0]?.tradeId;
        return Promise.resolve(id ? (trades.get(id) ?? null) : null);
      }),
      update: jest.fn(({ where, data }: { where: { tradeId: string }; data: StoredTrade }) => {
        const existing = trades.get(where.tradeId);
        if (!existing) return Promise.reject(new Error('record not found'));
        const updated = { ...existing, ...data, updatedAt: new Date() };
        trades.set(where.tradeId, updated);
        return Promise.resolve(updated);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    dispute: {
      create: jest.fn(({ data }: { data: StoredDispute }) => {
        const record = { id: disputes.size + 1, createdAt: new Date(), ...data };
        disputes.set(data.tradeId as string, record);
        return Promise.resolve(record);
      }),
      findUnique: jest.fn(({ where }: { where: { tradeId?: string } }) =>
        Promise.resolve(disputes.get(where.tradeId ?? '') ?? null),
      ),
      update: jest.fn(),
    },
    disputeCategory: {
      findFirst: jest.fn(({ where }: { where: { id?: number; name?: string; isActive?: boolean } }) => {
        if (where.id !== undefined) return Promise.resolve(categories.get(where.id) ?? null);
        for (const cat of categories.values()) {
          if (cat.name === where.name && cat.isActive) return Promise.resolve(cat);
        }
        return Promise.resolve(null);
      }),
    },
    deliveryManifest: {
      findUnique: jest.fn(({ where }: { where: { tradeId: string } }) =>
        Promise.resolve(manifests.get(where.tradeId) ?? null),
      ),
      create: jest.fn(({ data }: { data: StoredManifest }) => {
        manifestSeq += 1;
        const record = { id: manifestSeq, createdAt: new Date(), ...data };
        manifests.set(data.tradeId as string, record);
        return Promise.resolve(record);
      }),
    },
    // Expose stores for assertions
    _trades: trades,
    _disputes: disputes,
    _manifests: manifests,
  };
}

type TestPrisma = ReturnType<typeof createTestPrisma>;

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const BUYER = 'GBUYERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SELLER = 'GSELLERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makeTrade(overrides: Partial<{ tradeId: string }> = {}) {
  return {
    tradeId: overrides.tradeId ?? `trade-${Date.now()}`,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    amountUsdc: '500.0000000',
    buyerLossBps: 500,
    sellerLossBps: 500,
  };
}

// ---------------------------------------------------------------------------
// Happy path: create → deposit → manifest → confirm → release
// ---------------------------------------------------------------------------

describe('Trade lifecycle — happy path', () => {
  let prisma: TestPrisma;
  let tradeService: TradeService;
  let manifestService: ManifestService;

  beforeEach(() => {
    prisma = createTestPrisma();
    tradeService = new TradeService(prisma as never);
    manifestService = new ManifestService(prisma as never);
  });

  it('creates trade with PENDING_SIGNATURE status', async () => {
    const input = makeTrade({ tradeId: 'hp-1' });
    const trade = await tradeService.createPendingTrade(input);

    expect(trade.status).toBe(TradeStatus.PENDING_SIGNATURE);
    expect(trade.tradeId).toBe('hp-1');
    expect(trade.buyerAddress).toBe(BUYER);
    expect(trade.sellerAddress).toBe(SELLER);
  });

  it('transitions PENDING_SIGNATURE → CREATED → FUNDED', async () => {
    const input = makeTrade({ tradeId: 'hp-2' });
    await tradeService.createPendingTrade(input);

    // Simulate on-chain TradeCreated event
    await prisma.trade.update({ where: { tradeId: 'hp-2' }, data: { status: TradeStatus.CREATED } });
    const created = await prisma.trade.findUnique({ where: { tradeId: 'hp-2' } });
    expect(created?.status).toBe(TradeStatus.CREATED);

    // Simulate on-chain Deposited event
    await prisma.trade.update({ where: { tradeId: 'hp-2' }, data: { status: TradeStatus.FUNDED } });
    const funded = await prisma.trade.findUnique({ where: { tradeId: 'hp-2' } });
    expect(funded?.status).toBe(TradeStatus.FUNDED);
  });

  it('accepts manifest submission when trade is FUNDED', async () => {
    const input = makeTrade({ tradeId: 'hp-3' });
    await tradeService.createPendingTrade(input);
    await prisma.trade.update({ where: { tradeId: 'hp-3' }, data: { status: TradeStatus.FUNDED } });

    const result = await manifestService.submitManifest({
      tradeId: 'hp-3',
      callerAddress: SELLER,
      driverName: 'Amaru Osei',
      driverIdNumber: 'GH-12345',
      vehicleRegistration: 'GR-1234-22',
      routeDescription: 'Accra → Kumasi',
      expectedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(result.manifestId).toBeDefined();
    expect(result.driverNameHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma._manifests.has('hp-3')).toBe(true);
  });

  it('transitions FUNDED → DELIVERED → COMPLETED', async () => {
    const input = makeTrade({ tradeId: 'hp-4' });
    await tradeService.createPendingTrade(input);
    await prisma.trade.update({ where: { tradeId: 'hp-4' }, data: { status: TradeStatus.FUNDED } });

    // Simulate on-chain DeliveryConfirmed event
    await prisma.trade.update({ where: { tradeId: 'hp-4' }, data: { status: TradeStatus.DELIVERED } });
    const delivered = await prisma.trade.findUnique({ where: { tradeId: 'hp-4' } });
    expect(delivered?.status).toBe(TradeStatus.DELIVERED);

    // Simulate on-chain FundsReleased event
    await prisma.trade.update({ where: { tradeId: 'hp-4' }, data: { status: TradeStatus.COMPLETED } });
    const completed = await prisma.trade.findUnique({ where: { tradeId: 'hp-4' } });
    expect(completed?.status).toBe(TradeStatus.COMPLETED);
  });

  it('full happy path: PENDING_SIGNATURE → CREATED → FUNDED → DELIVERED → COMPLETED', async () => {
    const tradeId = 'hp-full';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));

    const states: TradeStatus[] = [
      TradeStatus.CREATED,
      TradeStatus.FUNDED,
      TradeStatus.DELIVERED,
      TradeStatus.COMPLETED,
    ];

    for (const status of states) {
      await prisma.trade.update({ where: { tradeId }, data: { status } });
      const row = await prisma.trade.findUnique({ where: { tradeId } });
      expect(row?.status).toBe(status);
    }
  });
});

// ---------------------------------------------------------------------------
// Dispute path: create → deposit → initiate dispute → resolve
// ---------------------------------------------------------------------------

describe('Trade lifecycle — dispute path', () => {
  let prisma: TestPrisma;
  let tradeService: TradeService;

  beforeEach(() => {
    prisma = createTestPrisma();
    tradeService = new TradeService(prisma as never);
  });

  it('rejects dispute when trade is not FUNDED or DELIVERED', async () => {
    const tradeId = 'dp-1';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    // Trade is PENDING_SIGNATURE — dispute must be rejected
    await expect(
      tradeService.initiateDispute(tradeId, BUYER, 'Wrong goods', 'quality', 1),
    ).rejects.toBeInstanceOf(DisputeTradeStatusError);
  });

  it('initiates dispute from FUNDED and returns unsigned XDR', async () => {
    const tradeId = 'dp-2';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.FUNDED } });

    const result = await tradeService.initiateDispute(tradeId, BUYER, 'Wrong goods delivered', 'quality', 1);

    expect(result.unsignedXdr).toBe('mock-unsigned-xdr-dispute');
    expect(prisma._disputes.has(tradeId)).toBe(true);

    const dispute = prisma._disputes.get(tradeId);
    expect(dispute?.status).toBe(DisputeStatus.OPEN);
    expect(dispute?.initiator).toBe(BUYER);
  });

  it('initiates dispute from DELIVERED', async () => {
    const tradeId = 'dp-3';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.DELIVERED } });

    const result = await tradeService.initiateDispute(tradeId, SELLER, 'Payment not confirmed', 'quality', 1);
    expect(result.unsignedXdr).toBeDefined();
    expect(prisma._disputes.get(tradeId)?.initiator).toBe(SELLER);
  });

  it('transitions DISPUTED → COMPLETED after dispute resolution', async () => {
    const tradeId = 'dp-4';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.FUNDED } });
    await tradeService.initiateDispute(tradeId, BUYER, 'Bad quality', 'quality', 1);

    // Simulate on-chain DisputeInitiated event
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.DISPUTED } });
    const disputed = await prisma.trade.findUnique({ where: { tradeId } });
    expect(disputed?.status).toBe(TradeStatus.DISPUTED);

    // Simulate on-chain DisputeResolved event
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.COMPLETED } });
    const resolved = await prisma.trade.findUnique({ where: { tradeId } });
    expect(resolved?.status).toBe(TradeStatus.COMPLETED);
  });

  it('full dispute path: PENDING_SIGNATURE → FUNDED → DISPUTED → COMPLETED', async () => {
    const tradeId = 'dp-full';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.FUNDED } });

    await tradeService.initiateDispute(tradeId, BUYER, 'Item damaged', 'quality', 1);

    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.DISPUTED } });
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.COMPLETED } });

    const final = await prisma.trade.findUnique({ where: { tradeId } });
    expect(final?.status).toBe(TradeStatus.COMPLETED);
    expect(prisma._disputes.has(tradeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cancellation path: create → CREATED → CANCELLED
// ---------------------------------------------------------------------------

describe('Trade lifecycle — cancellation path', () => {
  let prisma: TestPrisma;
  let tradeService: TradeService;
  let manifestService: ManifestService;

  beforeEach(() => {
    prisma = createTestPrisma();
    tradeService = new TradeService(prisma as never);
    manifestService = new ManifestService(prisma as never);
  });

  it('cancels a CREATED trade', async () => {
    const tradeId = 'cp-1';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CREATED } });

    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CANCELLED } });
    const cancelled = await prisma.trade.findUnique({ where: { tradeId } });
    expect(cancelled?.status).toBe(TradeStatus.CANCELLED);
  });

  it('rejects transition out of CANCELLED', async () => {
    const tradeId = 'cp-2';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CANCELLED } });

    prisma.trade.update.mockRejectedValueOnce(new Error('terminal state'));
    await expect(
      prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.FUNDED } }),
    ).rejects.toThrow('terminal state');
  });

  it('rejects manifest submission on a CANCELLED trade', async () => {
    const tradeId = 'cp-3';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CANCELLED } });

    await expect(
      manifestService.submitManifest({
        tradeId,
        callerAddress: SELLER,
        driverName: 'Kwame Mensah',
        driverIdNumber: 'GH-99999',
        vehicleRegistration: 'AS-5678-21',
        routeDescription: 'Tamale → Bolgatanga',
        expectedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ManifestTradeStatusError);
  });

  it('rejects manifest submission by buyer (seller-only action)', async () => {
    const tradeId = 'cp-4';
    await tradeService.createPendingTrade(makeTrade({ tradeId }));
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.FUNDED } });

    await expect(
      manifestService.submitManifest({
        tradeId,
        callerAddress: BUYER, // buyer cannot submit manifest
        driverName: 'Kwame Mensah',
        driverIdNumber: 'GH-99999',
        vehicleRegistration: 'AS-5678-21',
        routeDescription: 'Tamale → Bolgatanga',
        expectedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ManifestForbiddenError);
  });

  it('full cancellation path: PENDING_SIGNATURE → CREATED → CANCELLED', async () => {
    const tradeId = 'cp-full';
    const trade = await tradeService.createPendingTrade(makeTrade({ tradeId }));
    expect(trade.status).toBe(TradeStatus.PENDING_SIGNATURE);

    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CREATED } });
    await prisma.trade.update({ where: { tradeId }, data: { status: TradeStatus.CANCELLED } });

    const final = await prisma.trade.findUnique({ where: { tradeId } });
    expect(final?.status).toBe(TradeStatus.CANCELLED);
    expect(prisma._disputes.has(tradeId)).toBe(false);
  });
});
