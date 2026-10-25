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
      count: jest.Mock;
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
        findMany: jest.fn(),
        count: jest.fn(),
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
    service = new EvidenceVerificationService(mockPrisma, mockIpfs, 10);
  });

  interface EvidenceTestRecord {
    id: number;
    tradeId: string;
    cid: string;
    filename: string;
    mimeType: string;
    uploadedBy: string;
    createdAt: Date;
  }

  interface EvidencePageQuery {
    where?: {
      OR: [
        { createdAt: { gt: Date } },
        { createdAt: Date; id: { gt: number } },
      ];
    };
    take: number;
  }

  function makeEvidence(
    overrides: Partial<EvidenceTestRecord> = {},
  ): EvidenceTestRecord {
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

  function mockEvidencePages(records: EvidenceTestRecord[]) {
    mockPrisma.tradeEvidence.count.mockResolvedValue(records.length);
    mockPrisma.tradeEvidence.findMany.mockImplementation(
      async (args: EvidencePageQuery) => {
        let remaining = [...records].sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
        );

        if (args.where?.OR) {
          const afterDate = args.where.OR[0].createdAt.gt as Date;
          const sameDate = args.where.OR[1].createdAt as Date;
          const afterId = args.where.OR[1].id.gt as number;
          remaining = remaining.filter(
            (record) =>
              record.createdAt > afterDate ||
              (record.createdAt.getTime() === sameDate.getTime() &&
                record.id > afterId),
          );
        }

        return remaining.slice(0, args.take);
      },
    );
  }

  describe("verifyAll", () => {
    it("should return VerificationReport structure with no evidence", async () => {
      mockEvidencePages([]);
      const onProgress = jest.fn();

      const report = await service.verifyAll(onProgress);

      expect(report).toHaveProperty("totalChecked", 0);
      expect(report).toHaveProperty("pinnedCount", 0);
      expect(report).toHaveProperty("missingCount", 0);
      expect(report).toHaveProperty("errorCount", 0);
      expect(report).toHaveProperty("missingPins", []);
      expect(report).toHaveProperty("errors", []);
      expect(report).toHaveProperty("checkedAt");
      expect(report).toHaveProperty("durationMs");
      expect(onProgress).toHaveBeenCalledWith({
        processed: 0,
        total: 0,
        batchNumber: 0,
        batchDurationMs: 0,
      });
    });

    it("should report evidence as pinned when verified", async () => {
      mockEvidencePages([
        makeEvidence({ id: 1, cid: "QmPinned1" }),
      ]);
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
      mockEvidencePages([
        makeEvidence({ id: 1, cid: "QmMissing1" }),
      ]);
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
      mockEvidencePages([
        makeEvidence({ id: 1, cid: "QmError1" }),
      ]);
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
      mockEvidencePages(records);
      mockIpfs.verifyPin.mockResolvedValue({
        pinned: true,
        cid: "placeholder",
      });
      const progress: number[] = [];

      const report = await service.verifyAll(({ processed }) => {
        progress.push(processed);
      });

      expect(report.totalChecked).toBe(25);
      expect(mockIpfs.verifyPin).toHaveBeenCalled();
      expect(mockPrisma.tradeEvidence.findMany).toHaveBeenCalledTimes(4);
      expect(progress).toEqual([10, 20, 25]);
    });

    it("should handle duplicate CIDs efficiently", async () => {
      mockEvidencePages([
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

    it("should retry failed CID verifications before reporting an error", async () => {
      mockEvidencePages([makeEvidence({ id: 1, cid: "QmRetry" })]);
      mockIpfs.verifyPin
        .mockResolvedValueOnce({
          pinned: false,
          cid: "QmRetry",
          error: "Temporary network error",
        })
        .mockResolvedValueOnce({ pinned: true, cid: "QmRetry" });

      const report = await service.verifyAll();

      expect(mockIpfs.verifyPin).toHaveBeenCalledTimes(2);
      expect(report.pinnedCount).toBe(1);
      expect(report.errorCount).toBe(0);
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
