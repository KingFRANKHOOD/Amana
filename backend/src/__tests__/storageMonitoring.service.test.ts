import { StorageMonitoringService } from "../services/storageMonitoring.service";

describe("StorageMonitoringService", () => {
  it("collects table statistics and database size", async () => {
    const mockDb: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          table_name: "Trade",
          row_count: 50,
          total_size_bytes: 102400,
        },
        {
          table_name: "AuditLog",
          row_count: 200,
          total_size_bytes: 204800,
        },
      ]),
      trade: { count: jest.fn().mockResolvedValue(50) },
      user: { count: jest.fn().mockResolvedValue(10) },
      auditLog: { count: jest.fn().mockResolvedValue(200) },
      dispute: { count: jest.fn().mockResolvedValue(5) },
    };

    const mockMetrics: any = {
      recordStorageTableMetrics: jest.fn(),
      recordDatabaseSize: jest.fn(),
    };

    const service = new StorageMonitoringService(mockDb, mockMetrics);
    const snapshot = await service.collectStorageMetrics();

    expect(snapshot).toBeDefined();
    expect(snapshot.tables.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.collectedAt).toBeDefined();
    expect(mockMetrics.recordStorageTableMetrics).toHaveBeenCalledWith(
      "Trade",
      102400,
      50,
    );
  });

  it("handles database query failure by using fallback counting", async () => {
    const mockDb: any = {
      $queryRaw: jest.fn().mockRejectedValue(new Error("query failed")),
      trade: { count: jest.fn().mockResolvedValue(15) },
      user: { count: jest.fn().mockResolvedValue(8) },
      auditLog: { count: jest.fn().mockResolvedValue(50) },
      dispute: { count: jest.fn().mockResolvedValue(2) },
    };

    const mockMetrics: any = {
      recordStorageTableMetrics: jest.fn(),
      recordDatabaseSize: jest.fn(),
    };

    const service = new StorageMonitoringService(mockDb, mockMetrics);
    const snapshot = await service.collectStorageMetrics();

    expect(snapshot).toBeDefined();
    expect(snapshot.tables.length).toBe(4);
    expect(snapshot.databaseSizeBytes).toBeGreaterThan(0);
    expect(mockMetrics.recordDatabaseSize).toHaveBeenCalled();
  });
});
