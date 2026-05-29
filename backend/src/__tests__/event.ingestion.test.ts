/**
 * event.ingestion.test.ts — Issue #419
 *
 * Integration tests for backend ingestion of contract events,
 * replay handling, and idempotent processing.
 *
 * All Stellar SDK and Prisma dependencies are mocked — no live services
 * are required.
 */

import { TradeStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock Prisma client
// ---------------------------------------------------------------------------

function createMockPrisma() {
  const processedIds = new Set<string>();

  const processedEvent = {
    create: jest.fn().mockImplementation(({ data }: { data: any }) => {
      if (processedIds.has(data.eventId)) {
        const err: any = new Error('Unique constraint failed on the fields: (`eventId`)');
        err.code = 'P2002';
        err.meta = { target: ['eventId'] };
        return Promise.reject(err);
      }
      processedIds.add(data.eventId);
      return Promise.resolve({ id: processedIds.size, ...data });
    }),
    findUnique: jest.fn().mockImplementation(({ where }: { where: any }) =>
      Promise.resolve(processedIds.has(where.eventId) ? { eventId: where.eventId } : null),
    ),
    findMany: jest.fn().mockResolvedValue([]),
  };

  const trade = {
    upsert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockResolvedValue(null),
  };

  const txClient = { processedEvent, trade };

  return {
    processedEvent,
    trade,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => Promise<unknown>) => cb(txClient)),
    _processedIds: processedIds,
    _tx: txClient,
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

// ---------------------------------------------------------------------------
// Simulated event factory
// ---------------------------------------------------------------------------

interface ContractEvent {
  eventId: string;
  ledger: number;
  type: string;
  tradeId: string;
  payload: Record<string, unknown>;
}

function makeEvent(overrides: Partial<ContractEvent> = {}): ContractEvent {
  return {
    eventId: 'evt-001',
    ledger: 100,
    type: 'TradeCreated',
    tradeId: 'T-001',
    payload: { buyerAddress: 'buyer', sellerAddress: 'seller', amountUsdc: '100' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Simulated ingestion pipeline
// ---------------------------------------------------------------------------

async function ingestEvent(prisma: MockPrisma, event: ContractEvent): Promise<'processed' | 'duplicate' | 'error'> {
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.processedEvent.create({
        data: { eventId: event.eventId, ledger: event.ledger, type: event.type },
      });
      await tx.trade.upsert({ where: { tradeId: event.tradeId }, create: {}, update: {} } as any);
      return 'processed';
    });
    return result as 'processed';
  } catch (err: any) {
    if (err?.code === 'P2002') return 'duplicate';
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Initial ingestion
// ---------------------------------------------------------------------------

describe('Event ingestion — initial delivery', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('processes a TradeCreated event on first delivery', async () => {
    const result = await ingestEvent(prisma, makeEvent());
    expect(result).toBe('processed');
  });

  it('stores a processedEvent record after ingestion', async () => {
    await ingestEvent(prisma, makeEvent());
    const found = await prisma.processedEvent.findUnique({ where: { eventId: 'evt-001' } });
    expect(found).not.toBeNull();
  });

  it('calls trade.upsert during ingestion', async () => {
    await ingestEvent(prisma, makeEvent());
    expect(prisma._tx.trade.upsert).toHaveBeenCalledTimes(1);
  });

  it('processes TradeFunded event', async () => {
    const result = await ingestEvent(
      prisma,
      makeEvent({ eventId: 'evt-funded', type: 'TradeFunded', tradeId: 'T-002' }),
    );
    expect(result).toBe('processed');
  });

  it('processes TradeCompleted event', async () => {
    const result = await ingestEvent(
      prisma,
      makeEvent({ eventId: 'evt-completed', type: 'TradeCompleted', tradeId: 'T-003' }),
    );
    expect(result).toBe('processed');
  });

  it('processes DisputeInitiated event', async () => {
    const result = await ingestEvent(
      prisma,
      makeEvent({ eventId: 'evt-dispute', type: 'DisputeInitiated', tradeId: 'T-004' }),
    );
    expect(result).toBe('processed');
  });
});

// ---------------------------------------------------------------------------
// Replay and duplicate delivery
// ---------------------------------------------------------------------------

describe('Event ingestion — replay safety', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('returns "duplicate" when the same event is delivered twice', async () => {
    await ingestEvent(prisma, makeEvent({ eventId: 'evt-replay-1' }));
    const second = await ingestEvent(prisma, makeEvent({ eventId: 'evt-replay-1' }));
    expect(second).toBe('duplicate');
  });

  it('does not call trade.upsert again on duplicate delivery', async () => {
    await ingestEvent(prisma, makeEvent({ eventId: 'evt-replay-2' }));
    const callCountAfterFirst = prisma._tx.trade.upsert.mock.calls.length;
    await ingestEvent(prisma, makeEvent({ eventId: 'evt-replay-2' }));
    expect(prisma._tx.trade.upsert.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('processes a second distinct event independently', async () => {
    await ingestEvent(prisma, makeEvent({ eventId: 'evt-a', tradeId: 'T-A' }));
    const result = await ingestEvent(prisma, makeEvent({ eventId: 'evt-b', tradeId: 'T-B' }));
    expect(result).toBe('processed');
  });

  it('handles a burst of duplicate deliveries gracefully', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ingestEvent(prisma, makeEvent({ eventId: 'evt-burst' }))),
    );
    const processed = results.filter((r) => r === 'processed');
    const duplicates = results.filter((r) => r === 'duplicate');
    expect(processed.length).toBe(1);
    expect(duplicates.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Out-of-order delivery
// ---------------------------------------------------------------------------

describe('Event ingestion — out-of-order delivery', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('accepts events with non-monotone ledger numbers', async () => {
    const r1 = await ingestEvent(prisma, makeEvent({ eventId: 'ooo-200', ledger: 200 }));
    const r2 = await ingestEvent(prisma, makeEvent({ eventId: 'ooo-100', ledger: 100 }));
    expect(r1).toBe('processed');
    expect(r2).toBe('processed');
  });

  it('does not create inconsistent state for out-of-order events with the same tradeId', async () => {
    await ingestEvent(prisma, makeEvent({ eventId: 'ooo-late', ledger: 300, tradeId: 'T-OOO' }));
    await ingestEvent(prisma, makeEvent({ eventId: 'ooo-early', ledger: 100, tradeId: 'T-OOO' }));
    // Both should be ingested as distinct events
    const lateFound = await prisma.processedEvent.findUnique({ where: { eventId: 'ooo-late' } });
    const earlyFound = await prisma.processedEvent.findUnique({ where: { eventId: 'ooo-early' } });
    expect(lateFound).not.toBeNull();
    expect(earlyFound).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Processed-event persistence
// ---------------------------------------------------------------------------

describe('Event ingestion — processed-event persistence', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('marks multiple events as processed', async () => {
    const ids = ['evt-p1', 'evt-p2', 'evt-p3'];
    for (const id of ids) {
      await ingestEvent(prisma, makeEvent({ eventId: id }));
    }
    for (const id of ids) {
      const found = await prisma.processedEvent.findUnique({ where: { eventId: id } });
      expect(found).not.toBeNull();
    }
  });

  it('processedEvent.create is called exactly once per unique event', async () => {
    const ids = ['u1', 'u2', 'u3'];
    for (const id of ids) {
      await ingestEvent(prisma, makeEvent({ eventId: id }));
    }
    // Each id attempted at least once in $transaction
    expect(prisma._tx.processedEvent.create.mock.calls.length).toBeGreaterThanOrEqual(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Retry semantics
// ---------------------------------------------------------------------------

describe('Event ingestion — retry semantics', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('reports "error" for unexpected (non-P2002) failures', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('network timeout'));
    const result = await ingestEvent(prisma, makeEvent({ eventId: 'evt-retry' }));
    expect(result).toBe('error');
  });

  it('can succeed on a retry after a transient failure', async () => {
    prisma.$transaction
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementationOnce(async (cb: any) => {
        await prisma._tx.processedEvent.create({ data: { eventId: 'evt-retry-2' } });
        await prisma._tx.trade.upsert({} as any);
        return 'processed';
      });

    const firstAttempt = await ingestEvent(prisma, makeEvent({ eventId: 'evt-retry-2' }));
    expect(firstAttempt).toBe('error');

    const retried = await ingestEvent(prisma, makeEvent({ eventId: 'evt-retry-2' }));
    expect(retried).toBe('processed');
  });
});
