import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createDisputeCategoryRouter } from "../controllers/disputeCategory.controller";
import { AuthService } from "../services/auth.service";

function createMockPrisma() {
  return {
    disputeCategory: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildToken(walletAddress: string, jti: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti,
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      nbf: now - 1,
    },
    process.env.JWT_SECRET as string,
    { algorithm: "HS256" },
  );
}

const mockDate = new Date("2026-05-27T00:00:00.000Z");

describe("Dispute Category Routes", () => {
  const adminAddress = "G" + "A".repeat(55);
  const userAddress = "G" + "B".repeat(55);
  let adminToken: string;
  let userToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = buildToken(adminAddress, "dispute-category-admin-jti");
    userToken = buildToken(userAddress, "dispute-category-user-jti");
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("lists active dispute categories for authenticated users", async () => {
    const prisma = createMockPrisma();
    prisma.disputeCategory.findMany.mockResolvedValue([
      {
        id: 1,
        name: "DAMAGE",
        description: "Goods damaged",
        isActive: true,
        createdAt: mockDate,
        updatedAt: mockDate,
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use("/dispute-categories", createDisputeCategoryRouter(prisma as any));

    const res = await request(app)
      .get("/dispute-categories")
      .set("Authorization", `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: 1,
        name: "DAMAGE",
        description: "Goods damaged",
        isActive: true,
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    ]);
  });

  it("allows admin wallets to create categories", async () => {
    const prisma = createMockPrisma();
    prisma.disputeCategory.findUnique.mockResolvedValue(null);
    prisma.disputeCategory.create.mockResolvedValue({
      id: 2,
      name: "DELIVERY_DELAY",
      description: null,
      isActive: true,
      createdAt: mockDate,
      updatedAt: mockDate,
    });

    const app = express();
    app.use(express.json());
    app.use("/dispute-categories", createDisputeCategoryRouter(prisma as any));

    const res = await request(app)
      .post("/dispute-categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "DELIVERY_DELAY" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("DELIVERY_DELAY");
  });

  it("rejects category mutations by non-admin wallets", async () => {
    const prisma = createMockPrisma();
    const app = express();
    app.use(express.json());
    app.use("/dispute-categories", createDisputeCategoryRouter(prisma as any));

    const res = await request(app)
      .post("/dispute-categories")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "DAMAGE" });

    expect(res.status).toBe(403);
    expect(prisma.disputeCategory.create).not.toHaveBeenCalled();
  });
});
