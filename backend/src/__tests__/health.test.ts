import request from "supertest";
import { createApp } from "../app";

const mockPerformHealthCheck = jest.fn();

jest.mock("../services/health.service", () => {
  const actual = jest.requireActual("../services/health.service");
  return {
    ...actual,
    HealthService: jest.fn().mockImplementation(() => ({
      performHealthCheck: mockPerformHealthCheck,
    })),
  };
});

describe("GET /health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 200 with healthy status when DB is connected", async () => {
    mockPerformHealthCheck.mockResolvedValue({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: 1000,
      checks: {
        database: { status: "up", message: "Database connection healthy", responseTime: 5 },
        indexer: { status: "up", message: "Indexer healthy", responseTime: 3 },
      },
      details: {
        databaseLatency: 5,
        indexerLagSeconds: 0,
        lastProcessedLedger: 12345,
      },
    });

    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "healthy",
      checks: {
        database: { status: "up" },
        indexer: { status: "up" },
      },
    });
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it("should return 503 when DB is disconnected", async () => {
    mockPerformHealthCheck.mockResolvedValue({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: 1000,
      checks: {
        database: { status: "down", message: "Database check failed", responseTime: 10 },
        indexer: { status: "up", message: "Indexer healthy", responseTime: 3 },
      },
      details: {
        databaseLatency: 10,
        indexerLagSeconds: 0,
        lastProcessedLedger: 12345,
      },
    });

    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "unhealthy",
      checks: {
        database: { status: "down" },
      },
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it("should include valid ISO timestamp", async () => {
    mockPerformHealthCheck.mockResolvedValue({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: 1000,
      checks: {
        database: { status: "down", message: "Database check failed", responseTime: 10 },
        indexer: { status: "up", message: "Indexer healthy", responseTime: 3 },
      },
      details: {
        databaseLatency: 10,
        indexerLagSeconds: 0,
        lastProcessedLedger: 12345,
      },
    });

    const app = createApp();
    const res = await request(app).get("/health");

    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;
  integrationDescribe("integration with real database", () => {
    it("should return 200 with healthy status", async () => {
      const app = createApp();
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "healthy",
      });
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
