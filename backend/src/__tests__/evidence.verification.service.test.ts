jest.mock("axios", () => ({
  get: jest.fn(),
}));

import axios from "axios";
import { EvidenceVerificationService } from "../services/evidence.verification.service";
import { IPFSService } from "../services/ipfs.service";

const mockAxiosGet = axios.get as jest.Mock;

/** In-memory `findMany` that honours Prisma cursor pagination args. */
function paginatingFindMany(records: Array<{ id: number }>) {
  return jest.fn(async (args: any = {}) => {
    const sorted = [...records].sort((a, b) => Number(a.id) - Number(b.id));
    let start = 0;
    if (args.cursor?.id !== undefined) {
      const idx = sorted.findIndex((r) => r.id === args.cursor.id);
      start = idx === -1 ? sorted.length : idx + (args.skip ?? 0);
    }
    const take = args.take ?? sorted.length;
    return sorted.slice(start, start + take);
  });
}

describe("EvidenceVerificationService", () => {
  let mockPrisma: {
    tradeEvidence: {
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };
  let mockIpfs: jest.Mocked<Pick<IPFSService, "verifyPin" | "uploadFile" | "getFileUrl">>;
  let service: EvidenceVerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = {
      tradeEvidence: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    mockIpfs = {
      verifyPin: jest.fn(),
      uploadFile: jest.fn(),
      getFileUrl: jest.fn(),
    };
    mockAxiosGet.mockReset();
    // Retries disabled by default so the error-path tests stay fast; the
    // dedicated "retry" block opts back in with an instant injected sleep.
    service = new EvidenceVerificationService(mockPrisma as any, mockIpfs as any, 10, {
      maxRetries: 0,
      retryBackoffMs: 0,
    });
  });

  /** Wire both `findMany` (paginated) and `count` from one record list. */
  function seedEvidence(records: Array<{ id: number }>) {
    mockPrisma.tradeEvidence.findMany = paginatingFindMany(records);
    mockPrisma.tradeEvidence.count.mockResolvedValue(records.length);
  }

  function makeEvidence(overrides: Record<string, unknown> = {}) {
    return {
      id: (overrides.id as number) ?? 1,
      tradeId: overrides.tradeId ?? "trade-001",
      cid: overrides.cid ?? "QmTest123",
      filename: overrides.filename ?? "evidence.jpg",
      mimeType: overrides.mimeType ?? "image/jpeg",
      uploadedBy: overrides.uploadedBy ?? "guser",
      createdAt: overrides.createdAt ?? new Date(),
    };
  }

  describe("verifyAll", () => {
    it("should return VerificationReport structure with no evidence", async () => {
      seedEvidence([]);

      const report = await service.verifyAll();

      expect(report).toHaveProperty("totalChecked", 0);
      expect(report).toHaveProperty("pinnedCount", 0);
      expect(report).toHaveProperty("missingCount", 0);
      expect(report).toHaveProperty("errorCount", 0);
      expect(report).toHaveProperty("missingPins", []);
      expect(report).toHaveProperty("errors", []);
      expect(report).toHaveProperty("checkedAt");
      expect(report).toHaveProperty("durationMs");
    });

    it("should report evidence as pinned when verified", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmPinned1" })]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: true,
        cid: "QmPinned1",
        name: "test",
        size: 1000,
        timestamp: "2025-01-01T00:00:00Z",
      });

      const report = await service.verifyAll();

      expect(report.totalChecked).toBe(1);
      expect(report.pinnedCount).toBe(1);
      expect(report.missingCount).toBe(0);
      expect(report.errorCount).toBe(0);
    });

    it("should report evidence as missing when not pinned", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmMissing1" })]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: false,
        cid: "QmMissing1",
      });

      const report = await service.verifyAll();

      expect(report.totalChecked).toBe(1);
      expect(report.pinnedCount).toBe(0);
      expect(report.missingCount).toBe(1);
      expect(report.missingPins).toHaveLength(1);
      expect(report.missingPins[0]!.cid).toBe("QmMissing1");
    });

    it("should report errors when verification fails", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmError1" })]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: false,
        cid: "QmError1",
        error: "Network error",
      });

      const report = await service.verifyAll();

      expect(report.errorCount).toBe(1);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]!.pinResult.error).toBe("Network error");
    });

    it("should handle multiple evidence records with batch processing", async () => {
      const records = Array.from({ length: 25 }, (_, i) =>
        makeEvidence({ id: i + 1, cid: `QmTest${i}` }),
      );
      seedEvidence(records);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: true,
        cid: "placeholder",
      });

      const report = await service.verifyAll();

      expect(report.totalChecked).toBe(25);
      expect(mockIpfs.verifyPin).toHaveBeenCalled();
    });

    it("should handle duplicate CIDs efficiently", async () => {
      seedEvidence([
        makeEvidence({ id: 1, cid: "QmDup" }),
        makeEvidence({ id: 2, cid: "QmDup" }),
        makeEvidence({ id: 3, cid: "QmDup" }),
      ]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: true,
        cid: "QmDup",
      });

      const report = await service.verifyAll();

      expect(report.totalChecked).toBe(3);
      expect(report.pinnedCount).toBe(3);
      expect(mockIpfs.verifyPin).toHaveBeenCalledTimes(1);
    });

    it("streams the datastore in pages instead of one findMany", async () => {
      const records = Array.from({ length: 23 }, (_, i) =>
        makeEvidence({ id: i + 1, cid: `QmPage${i}` }),
      );
      seedEvidence(records);
      mockIpfs.verifyPin.mockImplementation(async (cid: string) => ({
        pinned: true,
        cid,
      }));

      const report = await service.verifyAll({ batchSize: 10 });

      // 23 records / batchSize 10 => 3 pages
      expect(report.totalChecked).toBe(23);
      expect(report.batchCount).toBe(3);
      expect(mockPrisma.tradeEvidence.findMany).toHaveBeenCalledTimes(3);
      const firstCall = mockPrisma.tradeEvidence.findMany.mock.calls[0]![0];
      expect(firstCall).toMatchObject({ take: 10, orderBy: { id: "asc" } });
      expect(firstCall.cursor).toBeUndefined();
      const secondCall = mockPrisma.tradeEvidence.findMany.mock.calls[1]![0];
      expect(secondCall).toMatchObject({ take: 10, skip: 1, cursor: { id: 10 } });
    });

    it("uses a configurable batch size", async () => {
      const records = Array.from({ length: 6 }, (_, i) =>
        makeEvidence({ id: i + 1, cid: `QmCfg${i}` }),
      );
      seedEvidence(records);
      mockIpfs.verifyPin.mockImplementation(async (cid: string) => ({
        pinned: true,
        cid,
      }));

      const report = await service.verifyAll({ batchSize: 2 });

      expect(report.batchCount).toBe(3);
      expect(report.batchMetrics).toHaveLength(3);
      expect(report.batchMetrics.every((b) => b.recordCount === 2)).toBe(true);
    });

    it("reports progress after every batch", async () => {
      const records = Array.from({ length: 5 }, (_, i) =>
        makeEvidence({ id: i + 1, cid: `QmProg${i}` }),
      );
      seedEvidence(records);
      mockIpfs.verifyPin.mockImplementation(async (cid: string) => ({
        pinned: true,
        cid,
      }));

      const progress: number[] = [];
      const report = await service.verifyAll({
        batchSize: 2,
        onProgress: (p) => {
          expect(p.totalRecords).toBe(5);
          progress.push(p.processedRecords);
        },
      });

      expect(progress).toEqual([2, 4, 5]);
      expect(report.performance.batchCount).toBe(3);
    });

    it("still works when the datastore cannot be counted", async () => {
      const records = [makeEvidence({ id: 1, cid: "QmNoCount" })];
      mockPrisma.tradeEvidence.findMany = paginatingFindMany(records);
      mockPrisma.tradeEvidence.count = undefined as unknown as jest.Mock;
      mockIpfs.verifyPin.mockResolvedValue({ pinned: true, cid: "QmNoCount" });

      const seen: Array<number | null> = [];
      const report = await service.verifyAll({
        onProgress: (p) => {
          seen.push(p.totalRecords);
        },
      });

      expect(report.totalChecked).toBe(1);
      expect(seen).toEqual([null]);
    });

    it("retries transient pin-check failures with backoff", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmFlaky" })]);
      mockIpfs.verifyPin
        .mockResolvedValueOnce({ pinned: false, cid: "QmFlaky", error: "Network error" })
        .mockResolvedValueOnce({ pinned: false, cid: "QmFlaky", error: "Network error" })
        .mockResolvedValueOnce({ pinned: true, cid: "QmFlaky" });

      const sleep = jest.fn().mockResolvedValue(undefined);
      const retryingService = new EvidenceVerificationService(
        mockPrisma as any,
        mockIpfs as any,
        10,
        { maxRetries: 3, retryBackoffMs: 5 },
      );

      const report = await retryingService.verifyAll({ sleep });

      expect(mockIpfs.verifyPin).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([5, 10]);
      expect(report.pinnedCount).toBe(1);
      expect(report.errorCount).toBe(0);
      expect(report.batchMetrics[0]!.retries).toBe(2);
      expect(report.performance.totalRetries).toBe(2);
    });

    it("gives up after maxRetries and records the failure", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmDead" })]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: false,
        cid: "QmDead",
        error: "Circuit breaker open",
      });

      const sleep = jest.fn().mockResolvedValue(undefined);
      const retryingService = new EvidenceVerificationService(
        mockPrisma as any,
        mockIpfs as any,
        10,
        { maxRetries: 2, retryBackoffMs: 1 },
      );

      const report = await retryingService.verifyAll({ sleep });

      expect(mockIpfs.verifyPin).toHaveBeenCalledTimes(3); // initial + 2 retries
      expect(report.errorCount).toBe(1);
      expect(report.batchMetrics[0]!.retries).toBe(2);
      expect(report.batchMetrics[0]!.failedCidCount).toBe(1);
    });

    it("does not retry permanent misconfiguration errors", async () => {
      seedEvidence([makeEvidence({ id: 1, cid: "QmNoJwt" })]);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: false,
        cid: "QmNoJwt",
        error: "PINATA_JWT not configured",
      });

      const sleep = jest.fn().mockResolvedValue(undefined);
      const retryingService = new EvidenceVerificationService(
        mockPrisma as any,
        mockIpfs as any,
        10,
        { maxRetries: 3, retryBackoffMs: 1 },
      );

      const report = await retryingService.verifyAll({ sleep });

      expect(mockIpfs.verifyPin).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(report.errorCount).toBe(1);
    });

    it("summarizes batch-processing performance", async () => {
      const records = Array.from({ length: 4 }, (_, i) =>
        makeEvidence({ id: i + 1, cid: `QmPerf${i}` }),
      );
      seedEvidence(records);
      mockIpfs.verifyPin.mockImplementation(async (cid: string) => ({
        pinned: true,
        cid,
      }));

      const report = await service.verifyAll({ batchSize: 2 });

      expect(report.performance).toMatchObject({
        batchCount: 2,
        batchesWithRetries: 0,
        totalRetries: 0,
      });
      expect(report.performance.avgBatchMs).toBeGreaterThanOrEqual(0);
      expect(report.performance.maxBatchMs).toBeGreaterThanOrEqual(
        report.performance.minBatchMs,
      );
      expect(report.performance.recordsPerSecond).toBeGreaterThanOrEqual(0);
    });
  });

  describe("repairMissingPins", () => {
    it("should repair missing evidence successfully", async () => {
      mockIpfs.getFileUrl.mockReturnValue("https://gateway.example.com/QmMissing1");
      mockAxiosGet.mockResolvedValue({ data: Buffer.from("test-data") });
      mockIpfs.uploadFile.mockResolvedValue("QmMissing1");

      const missingRecords = [
        {
          evidenceId: 1,
          tradeId: "trade-001",
          cid: "QmMissing1",
          filename: "evidence.jpg",
          mimeType: "image/jpeg",
          uploadedBy: "guser",
          createdAt: new Date(),
          pinResult: { pinned: false, cid: "QmMissing1" },
        },
      ];

      const results = await service.repairMissingPins(missingRecords);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.cid).toBe("QmMissing1");
      expect(mockPrisma.tradeEvidence.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { cid: "QmMissing1" },
      });
    });

    it("should handle CID mismatch after re-pin", async () => {
      mockIpfs.getFileUrl.mockReturnValue("https://gateway.example.com/QmOld");
      mockAxiosGet.mockResolvedValue({ data: Buffer.from("test-data") });
      mockIpfs.uploadFile.mockResolvedValue("QmNewCID");

      const missingRecords = [
        {
          evidenceId: 1,
          tradeId: "trade-001",
          cid: "QmOld",
          filename: "evidence.jpg",
          mimeType: "image/jpeg",
          uploadedBy: "guser",
          createdAt: new Date(),
          pinResult: { pinned: false, cid: "QmOld" },
        },
      ];

      const results = await service.repairMissingPins(missingRecords);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(mockPrisma.tradeEvidence.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { cid: "QmNewCID" },
      });
    });

    it("should handle gateway fetch failure", async () => {
      mockIpfs.getFileUrl.mockReturnValue("https://gateway.example.com/QmMissing");
      mockAxiosGet.mockRejectedValue(new Error("Gateway unreachable"));

      const missingRecords = [
        {
          evidenceId: 1,
          tradeId: "trade-001",
          cid: "QmMissing",
          filename: "evidence.jpg",
          mimeType: "image/jpeg",
          uploadedBy: "guser",
          createdAt: new Date(),
          pinResult: { pinned: false, cid: "QmMissing" },
        },
      ];

      const results = await service.repairMissingPins(missingRecords);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
      expect(results[0]!.error).toBeDefined();
    });

    it("should report errors during repair", async () => {
      mockIpfs.getFileUrl.mockImplementation(() => {
        throw new Error("IPFS service unavailable");
      });

      const missingRecords = [
        {
          evidenceId: 1,
          tradeId: "trade-001",
          cid: "QmFail",
          filename: "bad.jpg",
          mimeType: "image/jpeg",
          uploadedBy: "guser",
          createdAt: new Date(),
          pinResult: { pinned: false, cid: "QmFail" },
        },
      ];

      const results = await service.repairMissingPins(missingRecords);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
    });
  });
});
