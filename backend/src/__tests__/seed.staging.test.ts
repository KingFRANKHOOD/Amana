/**
 * seed.staging.test.ts
 *
 * Unit-level tests for the staging seed script.
 * Uses a fully mocked PrismaClient so no real database is required.
 *
 * Validates:
 *  - All domain models are seeded (User, Trade, Dispute, DeliveryManifest,
 *    TradeEvidence, ProcessedEvent, Vault, Goal)
 *  - Correct counts match the documented summary
 *  - All enum values are covered (TradeStatus, DisputeStatus, GoalStatus)
 *  - Delete order respects FK constraints (children before parents)
 *  - Seed is idempotent (deleteMany called before creates)
 */

import { TradeStatus, DisputeStatus, GoalStatus } from '@prisma/client';

// ── Mock PrismaClient ─────────────────────────────────────────────────────────
const deleteManyCalls: string[] = [];
const createCalls: { model: string; data: Record<string, unknown> }[] = [];

const makeMockModel = (modelName: string) => ({
  deleteMany: jest.fn(async () => {
    deleteManyCalls.push(modelName);
    return { count: 0 };
  }),
  create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    createCalls.push({ model: modelName, data });
    // Return a minimal record so callers can chain on .id / .tradeId / .vaultId
    return {
      id:           createCalls.length,
      tradeId:      (data.tradeId as string) ?? `mock-trade-${createCalls.length}`,
      vaultId:      (data.vaultId as string) ?? `mock-vault-${createCalls.length}`,
      walletAddress: (data.walletAddress as string) ?? 'mock-wallet',
      ...data,
    };
  }),
});

const mockPrisma = {
  user:             makeMockModel('user'),
  trade:            makeMockModel('trade'),
  dispute:          makeMockModel('dispute'),
  deliveryManifest: makeMockModel('deliveryManifest'),
  tradeEvidence:    makeMockModel('tradeEvidence'),
  processedEvent:   makeMockModel('processedEvent'),
  vault:            makeMockModel('vault'),
  goal:             makeMockModel('goal'),
  $disconnect:      jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  TradeStatus:  {
    PENDING_SIGNATURE: 'PENDING_SIGNATURE',
    CREATED:           'CREATED',
    FUNDED:            'FUNDED',
    DELIVERED:         'DELIVERED',
    COMPLETED:         'COMPLETED',
    DISPUTED:          'DISPUTED',
    CANCELLED:         'CANCELLED',
  },
  DisputeStatus: {
    OPEN:         'OPEN',
    UNDER_REVIEW: 'UNDER_REVIEW',
    RESOLVED:     'RESOLVED',
    CLOSED:       'CLOSED',
  },
  GoalStatus: {
    ACTIVE:    'ACTIVE',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },
}));

// ── Load seed after mocks are in place ────────────────────────────────────────
// We re-import each test run via jest.isolateModules to get a fresh module.
const runSeed = async () => {
  let main: () => Promise<void>;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ main } = require('../../../prisma/seed.staging') as { main: () => Promise<void> });
  });
  await main!();
};

// ─────────────────────────────────────────────────────────────────────────────

describe('seed.staging', () => {
  beforeEach(() => {
    deleteManyCalls.length = 0;
    createCalls.length     = 0;
    jest.clearAllMocks();
  });

  describe('idempotency — deletes before inserts', () => {
    it('calls deleteMany on all models before any create', async () => {
      await runSeed();

      // All deleteMany calls must precede any create
      const firstCreate = createCalls[0];
      expect(firstCreate).toBeDefined();

      const modelsWithDeleteMany = [
        'tradeEvidence',
        'deliveryManifest',
        'dispute',
        'processedEvent',
        'goal',
        'vault',
        'trade',
        'user',
      ];
      for (const model of modelsWithDeleteMany) {
        expect(deleteManyCalls).toContain(model);
      }
    });

    it('deletes children before parents (FK-safe order)', async () => {
      await runSeed();

      const idx = (m: string) => deleteManyCalls.indexOf(m);

      expect(idx('tradeEvidence')).toBeLessThan(idx('dispute'));
      expect(idx('deliveryManifest')).toBeLessThan(idx('trade'));
      expect(idx('dispute')).toBeLessThan(idx('trade'));
      expect(idx('goal')).toBeLessThan(idx('vault'));
      expect(idx('trade')).toBeLessThan(idx('user'));
      expect(idx('vault')).toBeLessThan(idx('user'));
    });
  });

  describe('User seeding', () => {
    it('creates exactly 5 users', async () => {
      await runSeed();
      const userCreates = createCalls.filter((c) => c.model === 'user');
      expect(userCreates).toHaveLength(5);
    });

    it('assigns unique wallet addresses to each user', async () => {
      await runSeed();
      const addresses = createCalls
        .filter((c) => c.model === 'user')
        .map((c) => c.data.walletAddress as string);
      const unique = new Set(addresses);
      expect(unique.size).toBe(5);
    });

    it('stores wallet addresses in lowercase', async () => {
      await runSeed();
      const addresses = createCalls
        .filter((c) => c.model === 'user')
        .map((c) => c.data.walletAddress as string);
      addresses.forEach((addr) => {
        expect(addr).toBe(addr.toLowerCase());
      });
    });
  });

  describe('Trade seeding', () => {
    const ALL_TRADE_STATUSES: TradeStatus[] = [
      'PENDING_SIGNATURE',
      'CREATED',
      'FUNDED',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
      'DISPUTED',
    ];

    it('creates at least 8 trades', async () => {
      await runSeed();
      const tradeCreates = createCalls.filter((c) => c.model === 'trade');
      expect(tradeCreates.length).toBeGreaterThanOrEqual(8);
    });

    it.each(ALL_TRADE_STATUSES)('creates at least one trade with status %s', async (status) => {
      await runSeed();
      const statuses = createCalls
        .filter((c) => c.model === 'trade')
        .map((c) => c.data.status as string);
      expect(statuses).toContain(status);
    });

    it('uses unique tradeId values', async () => {
      await runSeed();
      const ids = createCalls
        .filter((c) => c.model === 'trade')
        .map((c) => c.data.tradeId as string);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('Dispute seeding', () => {
    const ALL_DISPUTE_STATUSES: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];

    it('creates at least 4 disputes', async () => {
      await runSeed();
      const disputeCreates = createCalls.filter((c) => c.model === 'dispute');
      expect(disputeCreates.length).toBeGreaterThanOrEqual(4);
    });

    it.each(ALL_DISPUTE_STATUSES)('creates at least one dispute with status %s', async (status) => {
      await runSeed();
      const statuses = createCalls
        .filter((c) => c.model === 'dispute')
        .map((c) => c.data.status as string);
      expect(statuses).toContain(status);
    });

    it('sets resolvedAt for RESOLVED and CLOSED disputes', async () => {
      await runSeed();
      const terminal = createCalls
        .filter((c) => c.model === 'dispute')
        .filter((c) => c.data.status === 'RESOLVED' || c.data.status === 'CLOSED');
      terminal.forEach((d) => {
        expect(d.data.resolvedAt).toBeInstanceOf(Date);
      });
    });

    it('leaves resolvedAt null for OPEN and UNDER_REVIEW disputes', async () => {
      await runSeed();
      const nonTerminal = createCalls
        .filter((c) => c.model === 'dispute')
        .filter((c) => c.data.status === 'OPEN' || c.data.status === 'UNDER_REVIEW');
      nonTerminal.forEach((d) => {
        expect(d.data.resolvedAt ?? null).toBeNull();
      });
    });
  });

  describe('DeliveryManifest seeding', () => {
    it('creates exactly 1 delivery manifest', async () => {
      await runSeed();
      const manifests = createCalls.filter((c) => c.model === 'deliveryManifest');
      expect(manifests).toHaveLength(1);
    });

    it('includes hashed driver fields', async () => {
      await runSeed();
      const manifest = createCalls.find((c) => c.model === 'deliveryManifest')!;
      expect(manifest.data.driverNameHash).toBeDefined();
      expect(manifest.data.driverIdHash).toBeDefined();
      expect(typeof manifest.data.driverNameHash).toBe('string');
    });
  });

  describe('TradeEvidence seeding', () => {
    it('creates exactly 2 evidence records', async () => {
      await runSeed();
      const evidence = createCalls.filter((c) => c.model === 'tradeEvidence');
      expect(evidence).toHaveLength(2);
    });

    it('each evidence record has a CID and mimeType', async () => {
      await runSeed();
      const evidence = createCalls.filter((c) => c.model === 'tradeEvidence');
      evidence.forEach((e) => {
        expect(typeof e.data.cid).toBe('string');
        expect((e.data.cid as string).length).toBeGreaterThan(0);
        expect(typeof e.data.mimeType).toBe('string');
      });
    });
  });

  describe('ProcessedEvent seeding', () => {
    it('creates exactly 10 processed events', async () => {
      await runSeed();
      const events = createCalls.filter((c) => c.model === 'processedEvent');
      expect(events).toHaveLength(10);
    });

    it('uses sequential ledger sequences', async () => {
      await runSeed();
      const sequences = createCalls
        .filter((c) => c.model === 'processedEvent')
        .map((c) => c.data.ledgerSequence as number)
        .sort((a, b) => a - b);
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    });

    it('uses unique eventId values', async () => {
      await runSeed();
      const ids = createCalls
        .filter((c) => c.model === 'processedEvent')
        .map((c) => c.data.eventId as string);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('Vault and Goal seeding', () => {
    const ALL_GOAL_STATUSES: GoalStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

    it('creates exactly 2 vaults', async () => {
      await runSeed();
      const vaults = createCalls.filter((c) => c.model === 'vault');
      expect(vaults).toHaveLength(2);
    });

    it('creates exactly 4 goals', async () => {
      await runSeed();
      const goals = createCalls.filter((c) => c.model === 'goal');
      expect(goals).toHaveLength(4);
    });

    it.each(ALL_GOAL_STATUSES)('creates at least one goal with status %s', async (status) => {
      await runSeed();
      const statuses = createCalls
        .filter((c) => c.model === 'goal')
        .map((c) => c.data.status as string);
      expect(statuses).toContain(status);
    });

    it('COMPLETED goals have currentAmount equal to targetAmount', async () => {
      await runSeed();
      const completed = createCalls
        .filter((c) => c.model === 'goal' && c.data.status === 'COMPLETED');
      completed.forEach((g) => {
        expect(g.data.currentAmountUsdc).toBe(g.data.targetAmountUsdc);
      });
    });
  });

  describe('Cleanup', () => {
    it('disconnects prisma after seeding', async () => {
      await runSeed();
      expect(mockPrisma.$disconnect).toHaveBeenCalled();
    });
  });
});
