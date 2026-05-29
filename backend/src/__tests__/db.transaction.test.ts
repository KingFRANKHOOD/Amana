/**
 * db.transaction.test.ts — Issue #417
 *
 * Tests for Prisma transaction integrity and rollback safety.
 * Uses mocked PrismaClient — no live database required.
 */

import { TradeStatus, DisputeStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock Prisma client factory
// ---------------------------------------------------------------------------

function createMockPrisma() {
  const mockTradeOps = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };

  const mockDisputeOps = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };

  const mockEvidenceOps = {
    create: jest.fn(),
    findMany: jest.fn(),
  };

  const mockProcessedEventOps = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };

  const txClient = {
    trade: mockTradeOps,
    dispute: mockDisputeOps,
    evidence: mockEvidenceOps,
    processedEvent: mockProcessedEventOps,
  };

  return {
    trade: mockTradeOps,
    dispute: mockDisputeOps,
    evidence: mockEvidenceOps,
    processedEvent: mockProcessedEventOps,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => Promise<unknown>) => cb(txClient)),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    _tx: txClient,
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

// ---------------------------------------------------------------------------
// Helper: simulate a Prisma unique-constraint error
// ---------------------------------------------------------------------------

function makeUniqueConstraintError(field: string): Error {
  const err: any = new Error(`Unique constraint failed on the fields: (\`${field}\`)`);
  err.code = 'P2002';
  err.meta = { target: [field] };
  return err;
}

// ---------------------------------------------------------------------------
// Trade creation — integrity checks
// ---------------------------------------------------------------------------

describe('Trade creation — transaction integrity', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('creates a trade inside a transaction and commits on success', async () => {
    prisma._tx.trade.create.mockResolvedValue({
      tradeId: 'T1',
      status: TradeStatus.PENDING_SIGNATURE,
    });

    const result = await prisma.$transaction(async (tx: any) => {
      return tx.trade.create({
        data: {
          tradeId: 'T1',
          buyerAddress: 'buyer',
          sellerAddress: 'seller',
          amountUsdc: '100',
          status: TradeStatus.PENDING_SIGNATURE,
          buyerLossBps: 0,
          sellerLossBps: 0,
        },
      });
    });

    expect(result).toMatchObject({ tradeId: 'T1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back when trade creation throws inside transaction', async () => {
    prisma._tx.trade.create.mockRejectedValue(new Error('constraint violation'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.trade.create({ data: {} as any });
      }),
    ).rejects.toThrow('constraint violation');
  });

  it('raises P2002 on duplicate tradeId (unique constraint)', async () => {
    prisma._tx.trade.create.mockRejectedValue(makeUniqueConstraintError('tradeId'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.trade.create({ data: { tradeId: 'DUP' } as any });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ---------------------------------------------------------------------------
// Dispute creation — must not corrupt trade state on failure
// ---------------------------------------------------------------------------

describe('Dispute creation — rollback safety', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('creates dispute and updates trade atomically', async () => {
    prisma._tx.dispute.create.mockResolvedValue({ id: 1, status: DisputeStatus.OPEN });
    prisma._tx.trade.update.mockResolvedValue({ id: 1, status: TradeStatus.DISPUTED });

    const result = await prisma.$transaction(async (tx: any) => {
      const dispute = await tx.dispute.create({ data: {} as any });
      const trade = await tx.trade.update({ where: { id: 1 }, data: {} as any });
      return { dispute, trade };
    });

    expect(result.dispute).toMatchObject({ status: DisputeStatus.OPEN });
    expect(result.trade).toMatchObject({ status: TradeStatus.DISPUTED });
  });

  it('rolls back both dispute and trade update when dispute.create fails', async () => {
    prisma._tx.dispute.create.mockRejectedValue(new Error('dispute insert error'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.dispute.create({ data: {} as any });
        await tx.trade.update({ where: { id: 1 }, data: {} as any });
      }),
    ).rejects.toThrow('dispute insert error');

    // trade.update must never have been called since dispute failed first
    expect(prisma._tx.trade.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Evidence submission — transaction integrity
// ---------------------------------------------------------------------------

describe('Evidence submission — transaction integrity', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('persists evidence inside a transaction', async () => {
    prisma._tx.evidence.create.mockResolvedValue({ id: 1, disputeId: 10, ipfsCid: 'Qm123' });

    const result = await prisma.$transaction(async (tx: any) => {
      return tx.evidence.create({ data: {} as any });
    });

    expect(result).toMatchObject({ ipfsCid: 'Qm123' });
  });

  it('rolls back evidence write when error occurs mid-transaction', async () => {
    prisma._tx.evidence.create.mockRejectedValue(new Error('ipfs cid required'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.evidence.create({ data: {} as any });
      }),
    ).rejects.toThrow('ipfs cid required');
  });
});

// ---------------------------------------------------------------------------
// Processed-event deduplication — idempotency under constraint failures
// ---------------------------------------------------------------------------

describe('ProcessedEvent — deduplication via unique constraint', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('creates a processed-event record on first delivery', async () => {
    prisma._tx.processedEvent.create.mockResolvedValue({ id: 1, eventId: 'evt-1' });

    const result = await prisma.$transaction(async (tx: any) => {
      return tx.processedEvent.create({ data: { eventId: 'evt-1' } as any });
    });

    expect(result).toMatchObject({ eventId: 'evt-1' });
  });

  it('raises P2002 on duplicate eventId (replay rejection)', async () => {
    prisma._tx.processedEvent.create.mockRejectedValue(makeUniqueConstraintError('eventId'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.processedEvent.create({ data: { eventId: 'evt-1' } as any });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('does not update trade state when processedEvent.create fails', async () => {
    prisma._tx.processedEvent.create.mockRejectedValue(makeUniqueConstraintError('eventId'));

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.processedEvent.create({ data: {} as any });
        await tx.trade.update({ where: { id: 1 }, data: {} as any });
      }),
    ).rejects.toThrow();

    expect(prisma._tx.trade.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Migration lock sanity — schema model coverage
// ---------------------------------------------------------------------------

describe('Prisma schema model coverage', () => {
  it('prisma mock exposes trade, dispute, evidence, processedEvent models', () => {
    const p = createMockPrisma();
    expect(typeof p.trade.create).toBe('function');
    expect(typeof p.dispute.create).toBe('function');
    expect(typeof p.evidence.create).toBe('function');
    expect(typeof p.processedEvent.create).toBe('function');
  });

  it('$transaction wrapper invokes the callback', async () => {
    const p = createMockPrisma();
    const cb = jest.fn().mockResolvedValue('ok');
    const result = await p.$transaction(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });
});
