import {
  FeeAccountingService,
  DEFAULT_FEE_BPS,
  BPS_DIVISOR,
} from "../services/feeAccounting.service";

// ─── Mock Prisma ────────────────────────────────────────────────────────────────

function makeMockTx() {
  return {
    platformFeeEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
}

function makeMockDb() {
  return {
    platformFeeEvent: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

describe("FeeAccountingService", () => {
  describe("recordFee", () => {
    it("calculates 1% fee and creates a record", async () => {
      const tx = makeMockTx();
      const created = {
        id: 1,
        tradeId: "trade-001",
        tradeAmountUsdc: "100.00",
        feeUsdc: "1.000000",
        collectedAt: new Date(),
        ledgerSequence: 42,
      };
      tx.platformFeeEvent.findUnique.mockResolvedValue(null);
      tx.platformFeeEvent.create.mockResolvedValue(created);

      const svc = new FeeAccountingService({} as any);
      const result = await svc.recordFee(tx as any, "trade-001", "100.00", 42);

      expect(tx.platformFeeEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tradeId: "trade-001",
            tradeAmountUsdc: "100.00",
            feeUsdc: ((100 * DEFAULT_FEE_BPS) / BPS_DIVISOR).toFixed(6),
            ledgerSequence: 42,
          }),
        }),
      );
      expect(result.tradeId).toBe("trade-001");
    });

    it("uses the live fee rate after setFeeBps (e.g. admin raises fee to 3%)", async () => {
      const tx = makeMockTx();
      tx.platformFeeEvent.findUnique.mockResolvedValue(null);
      tx.platformFeeEvent.create.mockResolvedValue({ tradeId: "trade-300" });

      const svc = new FeeAccountingService({} as any);
      svc.setFeeBps(300);
      await svc.recordFee(tx as any, "trade-300", "100.00");

      expect(tx.platformFeeEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ feeUsdc: "3.000000" }),
        }),
      );
    });

    it("ignores out-of-range fee_bps updates", () => {
      const svc = new FeeAccountingService({} as any, 100);
      svc.setFeeBps(0);
      svc.setFeeBps(501);
      svc.setFeeBps(NaN);
      expect(svc.getFeeBps()).toBe(100);
    });

    it("is idempotent — returns existing record without re-creating", async () => {
      const tx = makeMockTx();
      const existing = {
        id: 1,
        tradeId: "trade-001",
        tradeAmountUsdc: "100.00",
        feeUsdc: "1.000000",
        collectedAt: new Date(),
        ledgerSequence: 42,
      };
      tx.platformFeeEvent.findUnique.mockResolvedValue(existing);

      const svc = new FeeAccountingService({} as any);
      const result = await svc.recordFee(tx as any, "trade-001", "100.00", 42);

      expect(tx.platformFeeEvent.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it("handles non-numeric amountUsdc as zero fee", async () => {
      const tx = makeMockTx();
      tx.platformFeeEvent.findUnique.mockResolvedValue(null);
      tx.platformFeeEvent.create.mockResolvedValue({
        id: 2,
        tradeId: "trade-002",
        tradeAmountUsdc: "NaN",
        feeUsdc: "0.000000",
        collectedAt: new Date(),
        ledgerSequence: null,
      });

      const svc = new FeeAccountingService({} as any);
      await svc.recordFee(tx as any, "trade-002", "NaN");

      expect(tx.platformFeeEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ feeUsdc: "0.000000" }),
        }),
      );
    });

    it("stores null ledgerSequence when not provided", async () => {
      const tx = makeMockTx();
      tx.platformFeeEvent.findUnique.mockResolvedValue(null);
      tx.platformFeeEvent.create.mockResolvedValue({
        id: 3,
        tradeId: "trade-003",
        tradeAmountUsdc: "50.00",
        feeUsdc: "0.500000",
        collectedAt: new Date(),
        ledgerSequence: null,
      });

      const svc = new FeeAccountingService({} as any);
      await svc.recordFee(tx as any, "trade-003", "50.00");

      expect(tx.platformFeeEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ledgerSequence: null }),
        }),
      );
    });
  });

  describe("listFees", () => {
    it("returns paginated results", async () => {
      const db = makeMockDb();
      const record = {
        id: 1,
        tradeId: "trade-001",
        tradeAmountUsdc: "100.00",
        feeUsdc: "1.000000",
        collectedAt: new Date(),
        ledgerSequence: 42,
      };
      db.platformFeeEvent.findMany.mockResolvedValue([record]);
      db.platformFeeEvent.count.mockResolvedValue(1);

      const svc = new FeeAccountingService(db as any);
      const result = await svc.listFees({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("applies date range filter", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([]);
      db.platformFeeEvent.count.mockResolvedValue(0);

      const dateFrom = new Date("2026-01-01");
      const dateTo = new Date("2026-12-31");

      const svc = new FeeAccountingService(db as any);
      await svc.listFees({ dateFrom, dateTo });

      expect(db.platformFeeEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            collectedAt: { gte: dateFrom, lte: dateTo },
          }),
        }),
      );
    });

    it("clamps limit to 100", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([]);
      db.platformFeeEvent.count.mockResolvedValue(0);

      const svc = new FeeAccountingService(db as any);
      await svc.listFees({ limit: 9999 });

      expect(db.platformFeeEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe("aggregateFees", () => {
    it("sums fee amounts correctly", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([
        { feeUsdc: "1.000000" },
        { feeUsdc: "2.500000" },
        { feeUsdc: "0.750000" },
      ]);

      const svc = new FeeAccountingService(db as any);
      const result = await svc.aggregateFees({});

      expect(result.totalFeesUsdc).toBe("4.250000");
      expect(result.totalTrades).toBe(3);
      expect(result.dateFrom).toBeNull();
      expect(result.dateTo).toBeNull();
    });

    it("returns zero total when no records exist", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([]);

      const svc = new FeeAccountingService(db as any);
      const result = await svc.aggregateFees({});

      expect(result.totalFeesUsdc).toBe("0.000000");
      expect(result.totalTrades).toBe(0);
    });

    it("includes date range in result when provided", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([]);

      const dateFrom = new Date("2026-01-01T00:00:00.000Z");
      const dateTo = new Date("2026-06-30T00:00:00.000Z");

      const svc = new FeeAccountingService(db as any);
      const result = await svc.aggregateFees({ dateFrom, dateTo });

      expect(result.dateFrom).toBe(dateFrom.toISOString());
      expect(result.dateTo).toBe(dateTo.toISOString());
    });
  });

  describe("exportCsv", () => {
    it("produces CSV with correct headers and rows", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([
        {
          id: 1,
          tradeId: "trade-001",
          tradeAmountUsdc: "100.00",
          feeUsdc: "1.000000",
          collectedAt: new Date("2026-07-01T00:00:00.000Z"),
          ledgerSequence: 42,
        },
      ]);

      const svc = new FeeAccountingService(db as any);
      const { csv, totalExported, truncated } = await svc.exportCsv({});

      expect(csv).toContain('"id"');
      expect(csv).toContain('"tradeId"');
      expect(csv).toContain('"feeUsdc"');
      expect(csv).toContain('"tradeAmountUsdc"');
      expect(csv).toContain("trade-001");
      expect(csv).toContain("1.000000");
      expect(totalExported).toBe(1);
      expect(truncated).toBe(false);
    });

    it("returns empty CSV rows when no records", async () => {
      const db = makeMockDb();
      db.platformFeeEvent.findMany.mockResolvedValue([]);

      const svc = new FeeAccountingService(db as any);
      const { csv, totalExported, truncated } = await svc.exportCsv({});

      // Headers still present, no data rows beyond header
      expect(csv).toContain('"id"');
      const lines = csv.trim().split("\n");
      expect(lines).toHaveLength(1); // header only
      expect(totalExported).toBe(0);
      expect(truncated).toBe(false);
    });

    it("enforces max row limit", async () => {
      const db = makeMockDb();
      const records = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        tradeId: `trade-${i + 1}`,
        tradeAmountUsdc: "100.00",
        feeUsdc: "1.000000",
        collectedAt: new Date("2026-07-01T00:00:00.000Z"),
        ledgerSequence: 42,
      }));
      db.platformFeeEvent.findMany.mockResolvedValue(records);

      const svc = new FeeAccountingService(db as any);
      const { csv, totalExported, truncated } = await svc.exportCsv({ maxRows: 2 });

      expect(totalExported).toBe(2);
      expect(truncated).toBe(true);
    });
  });
});
