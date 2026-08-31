import { EvidenceVerificationService } from '../evidence.verification.service';

/**
 * Minimal mock of the PrismaClient – just enough to exercise
 * cursor-based pagination and count().
 */
function createMockPrisma(records: Array<{ id: string; ipfsCid: string }>) {
  const findMany = jest.fn().mockImplementation(({ take, cursor, skip }: any) => {
    let startIdx = 0;
    if (cursor?.id) {
      const cursorIdx = records.findIndex((r) => r.id === cursor.id);
      startIdx = cursorIdx + (skip || 0);
    }
    return Promise.resolve(records.slice(startIdx, startIdx + take));
  });

  const count = jest.fn().mockResolvedValue(records.length);

  return { tradeEvidence: { findMany, count } } as any;
}

describe('EvidenceVerificationService', () => {
  describe('verifyAll – batch processing', () => {
    it('processes all records in batches without loading everything at once', async () => {
      const records = Array.from({ length: 250 }, (_, i) => ({
        id: `rec-${String(i).padStart(4, '0')}`,
        ipfsCid: `cid-${i}`,
      }));

      const prisma = createMockPrisma(records);
      const service = new EvidenceVerificationService(prisma, {
        batchSize: 100,
        maxRetries: 1,
        retryDelayMs: 0,
      });

      const report = await service.verifyAll();

      // 250 records / 100 batch size = 3 batches (100 + 100 + 50)
      expect(report.progress.totalBatches).toBe(3);
      expect(report.progress.total).toBe(250);
      expect(report.progress.processed).toBe(250);
      expect(report.progress.failed).toBe(0);
      expect(report.results).toHaveLength(250);

      // findMany should have been called once per batch
      expect(prisma.tradeEvidence.findMany).toHaveBeenCalledTimes(3);

      // Each call should have take: 100 (except the last which is ≤ 100)
      const calls = prisma.tradeEvidence.findMany.mock.calls;
      expect(calls[0][0].take).toBe(100);
      expect(calls[1][0].take).toBe(100);
      expect(calls[2][0].take).toBe(100);
    });

    it('reports progress via onProgress callback after each batch', async () => {
      const records = Array.from({ length: 50 }, (_, i) => ({
        id: `id-${i}`,
        ipfsCid: `cid-${i}`,
      }));

      const prisma = createMockPrisma(records);
      const service = new EvidenceVerificationService(prisma, { batchSize: 20 });

      const progressSnapshots: any[] = [];
      await service.verifyAll((p) => progressSnapshots.push({ ...p }));

      // 50 records / 20 batch size = 3 batches
      expect(progressSnapshots).toHaveLength(3);
      expect(progressSnapshots[0].processed).toBe(20);
      expect(progressSnapshots[0].currentBatch).toBe(1);
      expect(progressSnapshots[2].processed).toBe(50);
      expect(progressSnapshots[2].currentBatch).toBe(3);
    });

    it('retries failed batch items up to maxRetries times', async () => {
      const records = [
        { id: 'a', ipfsCid: 'cid-a' },
        { id: 'b', ipfsCid: 'cid-b' },
      ];

      const prisma = createMockPrisma(records);
      const service = new EvidenceVerificationService(prisma, {
        batchSize: 100,
        maxRetries: 2,
        retryDelayMs: 0,
      });

      // Mock checkPinStatus to fail once then succeed
      const original = (service as any).checkPinStatus.bind(service);
      let callCount = 0;
      (service as any).checkPinStatus = jest.fn().mockImplementation((cid: string) => {
        callCount++;
        if (cid === 'cid-b' && callCount <= 2) {
          throw new Error('transient failure');
        }
        return original(cid);
      });

      const report = await service.verifyAll();

      expect(report.progress.failed).toBe(0);
      expect(report.progress.succeeded).toBe(2);
      // At least 1 retry for cid-b (failed on attempt 0, succeeded on attempt 1)
      expect(report.progress.retries).toBeGreaterThanOrEqual(1);
    });

    it('marks records as failed after exhausting retries', async () => {
      const records = [{ id: 'x', ipfsCid: 'always-fails' }];
      const prisma = createMockPrisma(records);
      const service = new EvidenceVerificationService(prisma, {
        maxRetries: 1,
        retryDelayMs: 0,
      });

      (service as any).checkPinStatus = jest
        .fn()
        .mockRejectedValue(new Error('permanent failure'));

      const report = await service.verifyAll();

      expect(report.progress.failed).toBe(1);
      expect(report.results[0].verified).toBe(false);
      expect(report.results[0].error).toBe('permanent failure');
    });

    it('handles empty dataset gracefully', async () => {
      const prisma = createMockPrisma([]);
      const service = new EvidenceVerificationService(prisma);

      const report = await service.verifyAll();

      expect(report.progress.total).toBe(0);
      expect(report.progress.processed).toBe(0);
      expect(report.results).toHaveLength(0);
    });
  });

  describe('verifySingle', () => {
    it('returns error when CID not found', async () => {
      const prisma = {
        tradeEvidence: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      } as any;
      const service = new EvidenceVerificationService(prisma);

      const result = await service.verifySingle('missing-cid');
      expect(result.verified).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
