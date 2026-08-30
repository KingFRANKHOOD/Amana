import { AuditLogService, DEFAULT_AUDIT_LOG_RETENTION_DAYS } from "../services/auditLog.service";

function makeMockTx() {
  return {
    auditLog: {
      create: jest.fn(),
    },
  };
}

function makeMockDb() {
  return {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

describe("AuditLogService", () => {
  describe("record", () => {
    it("inserts an append-only audit row with the given fields", async () => {
      const tx = makeMockTx();
      tx.auditLog.create.mockResolvedValue({});
      const service = new AuditLogService({} as any);

      await service.record(tx as any, {
        tradeId: "trade-001",
        eventType: "TradeCreated",
        toStatus: "CREATED",
        actor: "GBUYER",
        amountUsdc: "100.00",
        ledgerSequence: 42,
        contractId: "CONTRACT_TEST",
        metadata: { seller: "GSELLER" },
      });

      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: {
          tradeId: "trade-001",
          eventType: "TradeCreated",
          toStatus: "CREATED",
          actor: "GBUYER",
          amountUsdc: "100.00",
          ledgerSequence: 42,
          contractId: "CONTRACT_TEST",
          metadata: { seller: "GSELLER" },
        },
      });
    });

    it("normalizes missing optional fields to null instead of undefined", async () => {
      const tx = makeMockTx();
      tx.auditLog.create.mockResolvedValue({});
      const service = new AuditLogService({} as any);

      await service.record(tx as any, {
        tradeId: "trade-002",
        eventType: "TradeFunded",
        toStatus: "FUNDED",
      });

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor: null,
            amountUsdc: null,
            ledgerSequence: null,
            contractId: null,
          }),
        }),
      );
    });
  });

  describe("list", () => {
    it("paginates and filters by tradeId and eventType", async () => {
      const db = makeMockDb();
      db.auditLog.findMany.mockResolvedValue([{ id: 1 }]);
      db.auditLog.count.mockResolvedValue(1);
      const service = new AuditLogService(db as any);

      const result = await service.list({ tradeId: "trade-001", eventType: "TradeCreated", page: 2, limit: 10 });

      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tradeId: "trade-001", eventType: "TradeCreated" },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    });

    it("clamps limit to the maximum of 100", async () => {
      const db = makeMockDb();
      db.auditLog.findMany.mockResolvedValue([]);
      db.auditLog.count.mockResolvedValue(0);
      const service = new AuditLogService(db as any);

      await service.list({ limit: 5000 });

      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe("pruneExpired", () => {
    it("deletes rows older than the retention window", async () => {
      const db = makeMockDb();
      db.auditLog.deleteMany.mockResolvedValue({ count: 5 });
      const service = new AuditLogService(db as any);

      const deleted = await service.pruneExpired(30);

      expect(deleted).toBe(5);
      expect(db.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expect.any(Date) } },
      });
    });

    it("defaults to DEFAULT_AUDIT_LOG_RETENTION_DAYS-equivalent cutoff when not overridden by env", async () => {
      const db = makeMockDb();
      db.auditLog.deleteMany.mockResolvedValue({ count: 0 });
      const service = new AuditLogService(db as any);

      const before = Date.now();
      await service.pruneExpired(DEFAULT_AUDIT_LOG_RETENTION_DAYS);
      const call = db.auditLog.deleteMany.mock.calls[0][0];
      const cutoffMs = call.where.createdAt.lt.getTime();

      const expectedCutoff = before - DEFAULT_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoffMs - expectedCutoff)).toBeLessThan(5000);
    });
  });
});
