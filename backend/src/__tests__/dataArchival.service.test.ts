import fs from "fs";
import path from "path";
import { DataArchivalService } from "../services/dataArchival.service";
import { TradeStatus } from "@prisma/client";

const TEST_STORAGE_DIR = path.resolve(__dirname, "../../scratch/test_archives");

function cleanTestDir() {
  if (fs.existsSync(TEST_STORAGE_DIR)) {
    fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  }
}

describe("DataArchivalService", () => {
  let mockDb: any;
  let service: DataArchivalService;

  beforeEach(() => {
    cleanTestDir();
    mockDb = {
      trade: {
        findMany: jest.fn(),
      },
    };
    service = new DataArchivalService(mockDb as any, TEST_STORAGE_DIR);
  });

  afterAll(() => {
    cleanTestDir();
  });

  describe("archiveColdTrades", () => {
    it("returns null if no cold trades exist", async () => {
      mockDb.trade.findMany.mockResolvedValue([]);
      const result = await service.archiveColdTrades(180);
      expect(result).toBeNull();
    });

    it("creates compressed archive bundle and metadata file with valid SHA-256", async () => {
      const mockTrades = [
        {
          id: 1,
          tradeId: "trade-cold-001",
          buyerAddress: "gbuyer",
          sellerAddress: "gseller",
          amountUsdc: "100",
          status: TradeStatus.COMPLETED,
          createdAt: new Date("2025-01-01T00:00:00Z"),
          updatedAt: new Date("2025-01-02T00:00:00Z"),
          dispute: null,
          manifest: null,
          evidence: [],
          notes: [],
          releaseMilestones: [],
        },
        {
          id: 2,
          tradeId: "trade-cold-002",
          buyerAddress: "gbuyer2",
          sellerAddress: "gseller2",
          amountUsdc: "250",
          status: TradeStatus.CANCELLED,
          createdAt: new Date("2025-01-05T00:00:00Z"),
          updatedAt: new Date("2025-01-06T00:00:00Z"),
          dispute: null,
          manifest: null,
          evidence: [],
          notes: [],
          releaseMilestones: [],
        },
      ];

      mockDb.trade.findMany.mockResolvedValue(mockTrades);

      const result = await service.archiveColdTrades(180);
      expect(result).not.toBeNull();
      expect(result!.recordCount).toBe(2);
      expect(result!.checksumSha256).toBeDefined();
      expect(fs.existsSync(result!.filePath)).toBe(true);

      // Verify the created archive
      const verification = service.verifyArchive(result!.archiveId, "trades");
      expect(verification.isValid).toBe(true);
      expect(verification.recordCount).toBe(2);
      expect(verification.checksumMatch).toBe(true);

      // Verify finding an archived trade
      const retrieved = service.findArchivedTrade("trade-cold-001");
      expect(retrieved).not.toBeNull();
      expect((retrieved as any).tradeId).toBe("trade-cold-001");

      // Verify listArchives returns the metadata
      const archives = service.listArchives();
      expect(archives.length).toBe(1);
      expect(archives[0]?.archiveId).toBe(result!.archiveId);
    });
  });

  describe("verifyArchive with corrupted or missing file", () => {
    it("returns isValid false when archive does not exist", () => {
      const verification = service.verifyArchive("nonexistent_id", "trades");
      expect(verification.isValid).toBe(false);
      expect(verification.error).toBeDefined();
    });
  });
});
