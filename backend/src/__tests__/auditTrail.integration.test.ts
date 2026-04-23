import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createAuditTrailRouter } from "../routes/auditTrail.routes";
import { AuthService } from "../services/auth.service";

jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);

describe("Audit Trail API", () => {
  const walletAddress = "GBBD47IF6LWK7P7MDEVSCWTTCJM4TWCH6TZZRVDI0Z00USDC";
  const token = jwt.sign(
    {
      walletAddress,
      jti: "audit-route-jti",
      nbf: Math.floor(Date.now() / 1000) - 5,
    },
    process.env.JWT_SECRET || "test-secret-at-least-32-characters-long",
    {
      issuer: process.env.JWT_ISSUER || "amana",
      audience: process.env.JWT_AUDIENCE || "amana-api",
    }
  );

  const service = {
    getTradeHistory: jest.fn(),
    getCanonicalPayload: jest.fn(),
    signPayload: jest.fn(),
    verifyPayload: jest.fn(),
  };

  const app = express();
  app.use("/trades", createAuditTrailRouter(service as any));

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns signed metadata when signed=true", async () => {
    const events = [{ eventType: "CREATED", timestamp: new Date("2026-01-01T00:00:00Z"), actor: walletAddress, metadata: {} }];
    const payload = { tradeId: "t-1", generatedAt: "2026-01-01T00:00:00.000Z", events: [] };
    const integrity = { algorithm: "ed25519", keyId: "test-key", payloadHash: "abc", signature: "sig" };
    service.getTradeHistory.mockResolvedValue(events);
    service.getCanonicalPayload.mockReturnValue(payload);
    service.signPayload.mockReturnValue(integrity);

    const res = await request(app)
      .get("/trades/t-1/history?signed=true")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.integrity).toEqual(integrity);
    expect(res.body.canonicalPayload).toEqual(payload);
  });

  it("verifies signature via /history/verify endpoint", async () => {
    const events = [{ eventType: "CREATED", timestamp: new Date("2026-01-01T00:00:00Z"), actor: walletAddress, metadata: {} }];
    const payload = { tradeId: "t-1", generatedAt: "2026-01-01T00:00:00.000Z", events: [] };
    service.getTradeHistory.mockResolvedValue(events);
    service.getCanonicalPayload.mockReturnValue(payload);
    service.verifyPayload.mockReturnValue(true);
    process.env.AUDIT_SIGNING_KEY_ID = "test-key";

    const res = await request(app)
      .get("/trades/t-1/history/verify?signature=ZmFrZXNpZw==")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.algorithm).toBe("ed25519");
  });
});
