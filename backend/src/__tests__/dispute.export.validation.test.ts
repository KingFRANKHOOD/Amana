import express from "express";
import request from "supertest";
import {
  createDisputeRouter,
  exportDisputesQuerySchema,
} from "../controllers/dispute.controller";

jest.mock("../middleware/auth.middleware", () => {
  const actual = jest.requireActual("../middleware/auth.middleware");
  return {
    ...actual,
    authMiddleware: (req: any, _res: any, next: any) => {
      req.user = { walletAddress: "G" + "M".repeat(55) };
      next();
    },
  };
});

jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: () => true,
}));

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use("/", createDisputeRouter(prisma));
  return app;
}

describe("GET /disputes/export date validation (issue #1399)", () => {
  const prisma = {
    dispute: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const app = buildApp(prisma);

  beforeEach(() => {
    prisma.dispute.findMany.mockClear();
  });

  it.each([
    ["from", "not-a-date"],
    ["to", "not-a-date"],
    ["from", "2024-13-45"],
  ])("rejects malformed %s=%s with 400 before querying", async (param, value) => {
    const res = await request(app).get(`/export?${param}=${encodeURIComponent(value)}`);

    expect(res.status).toBe(400);
    expect(prisma.dispute.findMany).not.toHaveBeenCalled();
  });

  it("accepts valid dates", async () => {
    const res = await request(app).get("/export?from=2024-01-01&to=2024-02-01T00:00:00Z");

    expect(res.status).toBe(200);
    expect(prisma.dispute.findMany).toHaveBeenCalledTimes(1);
  });

  it("schema rejects a lone malformed from value", () => {
    expect(exportDisputesQuerySchema.safeParse({ from: "not-a-date" }).success).toBe(false);
  });

  it("schema still rejects from after to", () => {
    expect(
      exportDisputesQuerySchema.safeParse({ from: "2024-02-01", to: "2024-01-01" }).success,
    ).toBe(false);
  });
});
