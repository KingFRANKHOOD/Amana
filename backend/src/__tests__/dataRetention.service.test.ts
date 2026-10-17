import { DataRetentionService } from "../services/dataRetention.service";
import { TradeStatus, ChainEventSyncStatus } from "@prisma/client";

function makeMockDb() {
  return {
    refreshToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
    },
    inAppNotification: {
      deleteMany: jest.fn().mockResolvedValue({ count: 12 }),
    },
    webhookDeliveryAttempt: {
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
    },
    processedEvent: {
      deleteMany: jest.fn().mockResolvedValue({ count: 20 }),
    },
    chainEventOutbox: {
      deleteMany: jest.fn().mockResolvedValue({ count: 8 }),
    },
    indexedEvent: {
      deleteMany: jest.fn().mockResolvedValue({ count: 15 }),
    },
    tradeNote: {
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    deliveryManifest: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    auditLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("DataRetentionService", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let service: DataRetentionService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new DataRetentionService(mockDb as any);
  });

  describe("pruneExpiredRefreshTokens", () => {
    it("deletes refresh tokens past expiration retention cutoff", async () => {
      const count = await service.pruneExpiredRefreshTokens(7);
      expect(count).toBe(5);
      expect(mockDb.refreshToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { expiresAt: expect.any(Object) },
        }),
      );
    });
  });

  describe("pruneExpiredNotifications", () => {
    it("prunes read notifications at 30 days and unread at 90 days", async () => {
      const res = await service.pruneExpiredNotifications(30, 90);
      expect(res.read).toBe(12);
      expect(res.unread).toBe(12);
      expect(mockDb.inAppNotification.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("pruneExpiredWebhookDeliveryAttempts", () => {
    it("deletes delivery logs older than retention cutoff", async () => {
      const count = await service.pruneExpiredWebhookDeliveryAttempts(14);
      expect(count).toBe(4);
      expect(mockDb.webhookDeliveryAttempt.deleteMany).toHaveBeenCalledWith({
        where: { timestamp: expect.any(Object) },
      });
    });
  });

  describe("pruneExpiredProcessedEvents", () => {
    it("deletes deduplication event logs older than retention", async () => {
      const count = await service.pruneExpiredProcessedEvents(30);
      expect(count).toBe(20);
      expect(mockDb.processedEvent.deleteMany).toHaveBeenCalled();
    });
  });

  describe("pruneExpiredChainEventOutbox", () => {
    it("prunes processed and dead-lettered events according to respective thresholds", async () => {
      const res = await service.pruneExpiredChainEventOutbox(14, 90);
      expect(res.processed).toBe(8);
      expect(res.deadLetter).toBe(8);
      expect(mockDb.chainEventOutbox.deleteMany).toHaveBeenCalledWith({
        where: {
          status: ChainEventSyncStatus.PROCESSED,
          processedAt: expect.any(Object),
        },
      });
      expect(mockDb.chainEventOutbox.deleteMany).toHaveBeenCalledWith({
        where: {
          status: ChainEventSyncStatus.DEAD_LETTER,
          deadLetteredAt: expect.any(Object),
        },
      });
    });
  });

  describe("pruneExpiredTradeNotes", () => {
    it("deletes private notes only for completed or cancelled trades beyond retention", async () => {
      const count = await service.pruneExpiredTradeNotes(90);
      expect(count).toBe(3);
      expect(mockDb.tradeNote.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: expect.any(Object),
          trade: {
            status: {
              in: [TradeStatus.COMPLETED, TradeStatus.CANCELLED],
            },
          },
        },
      });
    });
  });

  describe("redactExpiredManifestPII", () => {
    it("redacts driver PII fields for aged manifests", async () => {
      const count = await service.redactExpiredManifestPII(30);
      expect(count).toBe(2);
      expect(mockDb.deliveryManifest.updateMany).toHaveBeenCalledWith({
        where: {
          createdAt: expect.any(Object),
          NOT: {
            driverName: "[REDACTED]",
          },
        },
        data: {
          driverName: "[REDACTED]",
          driverIdNumber: "[REDACTED]",
          routeDescription: "[REDACTED_POST_RETENTION]",
        },
      });
    });
  });

  describe("runAllRetentionJobs", () => {
    it("executes all retention prune operations and aggregates totals", async () => {
      const result = await service.runAllRetentionJobs();
      expect(result.totalPruned).toBeGreaterThan(0);
      expect(result.refreshTokens).toBe(5);
      expect(result.readNotifications).toBe(12);
      expect(result.unreadNotifications).toBe(12);
      expect(result.webhookDeliveryAttempts).toBe(4);
      expect(result.processedEvents).toBe(20);
      expect(result.tradeNotes).toBe(3);
      expect(result.manifestPiiRedacted).toBe(2);
      expect(result.executedAt).toBeDefined();
      expect(service.getLastPruneResult()).toEqual(result);
    });
  });
});
