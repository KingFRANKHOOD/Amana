import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createAuditTrailRouter } from "../routes/auditTrail.routes";
import {
    AuditTrailService,
    AuditTrailAccessDeniedError,
    AuditTrailTradeNotFoundError,
} from "../services/auditTrail.service";
import { AuthService } from "../services/auth.service";

jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);

const BUYER = "GCBUYER0000000000000000000000000000000000000000000000000";
const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const STRANGER = "GCSTRANGER00000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-001";

const JWT_SECRET = "test-secret-at-least-32-characters-long";

function makeToken(walletAddress: string) {
    return jwt.sign({ walletAddress }, JWT_SECRET);
}

const t1 = new Date("2026-03-01T10:00:00.000Z");
const t2 = new Date("2026-03-02T10:00:00.000Z");
const t3 = new Date("2026-03-03T10:00:00.000Z");
const t4 = new Date("2026-03-04T10:00:00.000Z");

const mockEvents = [
    { eventType: "CREATED", timestamp: t1, actor: BUYER, metadata: { amountUsdc: "100" } },
    { eventType: "FUNDED", timestamp: t2, actor: BUYER, metadata: {} },
    { eventType: "MANIFEST_SUBMITTED", timestamp: t3, actor: SELLER, metadata: { vehicleRegistration: "ABC-123" } },
    { eventType: "EVIDENCE_SUBMITTED", timestamp: t4, actor: BUYER, metadata: { cid: "bafybeiabc", filename: "photo.jpg", mimeType: "image/jpeg" } },
];

describe("Audit Trail Routes — GET /trades/:id/history", () => {
    let app: express.Application;
    let mockGetTradeHistory: jest.Mock;

    beforeAll(() => {
        process.env.JWT_SECRET = JWT_SECRET;
    });

    beforeEach(() => {
        // Create a fresh mock for each test and inject it via the factory parameter
        mockGetTradeHistory = jest.fn();
        const mockService = { getTradeHistory: mockGetTradeHistory } as unknown as AuditTrailService;

        app = express();
        app.use(express.json());
        app.use("/trades", createAuditTrailRouter(mockService));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("authentication", () => {
        it("returns 401 when no Authorization header is provided", async () => {
            const res = await request(app).get(`/trades/${TRADE_ID}/history`);
            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });

        it("returns 401 for a malformed token", async () => {
            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", "Bearer not-a-valid-jwt");
            expect(res.status).toBe(401);
        });
    });

    describe("authorization", () => {
        it("returns 403 when caller is not a party to the trade", async () => {
            mockGetTradeHistory.mockRejectedValue(new AuditTrailAccessDeniedError());

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(STRANGER)}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/access denied/i);
        });
    });

    describe("not found", () => {
        it("returns 404 when trade does not exist", async () => {
            mockGetTradeHistory.mockRejectedValue(new AuditTrailTradeNotFoundError());

            const res = await request(app)
                .get(`/trades/nonexistent-trade/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/not found/i);
        });
    });

    describe("JSON response", () => {
        it("returns 200 with events array for an authorized buyer", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("events");
            expect(Array.isArray(res.body.events)).toBe(true);
            expect(res.body.events).toHaveLength(mockEvents.length);
        });

        it("returns 200 with events array for an authorized seller", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(SELLER)}`);

            expect(res.status).toBe(200);
            expect(res.body.events).toHaveLength(mockEvents.length);
        });

        it("passes the correct tradeId and callerAddress to the service", async () => {
            mockGetTradeHistory.mockResolvedValue([]);

            await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(mockGetTradeHistory).toHaveBeenCalledWith(TRADE_ID, BUYER);
        });

        it("returns events with the expected shape", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            const first = res.body.events[0];
            expect(first).toHaveProperty("eventType");
            expect(first).toHaveProperty("timestamp");
            expect(first).toHaveProperty("actor");
            expect(first).toHaveProperty("metadata");
        });

        it("returns all required event types when present", async () => {
            const allEventTypes = [
                { eventType: "CREATED", timestamp: t1, actor: BUYER, metadata: {} },
                { eventType: "FUNDED", timestamp: t2, actor: BUYER, metadata: {} },
                { eventType: "MANIFEST_SUBMITTED", timestamp: t2, actor: SELLER, metadata: {} },
                { eventType: "VIDEO_SUBMITTED", timestamp: t3, actor: BUYER, metadata: {} },
                { eventType: "DELIVERY_CONFIRMED", timestamp: t3, actor: BUYER, metadata: {} },
                { eventType: "DISPUTE_INITIATED", timestamp: t3, actor: BUYER, metadata: {} },
                { eventType: "EVIDENCE_SUBMITTED", timestamp: t4, actor: SELLER, metadata: {} },
                { eventType: "RESOLVED", timestamp: t4, actor: SELLER, metadata: {} },
                { eventType: "COMPLETED", timestamp: t4, actor: SELLER, metadata: {} },
            ];
            mockGetTradeHistory.mockResolvedValue(allEventTypes);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            const returnedTypes = res.body.events.map((e: { eventType: string }) => e.eventType);
            expect(returnedTypes).toContain("CREATED");
            expect(returnedTypes).toContain("FUNDED");
            expect(returnedTypes).toContain("MANIFEST_SUBMITTED");
            expect(returnedTypes).toContain("VIDEO_SUBMITTED");
            expect(returnedTypes).toContain("DELIVERY_CONFIRMED");
            expect(returnedTypes).toContain("DISPUTE_INITIATED");
            expect(returnedTypes).toContain("EVIDENCE_SUBMITTED");
            expect(returnedTypes).toContain("RESOLVED");
            expect(returnedTypes).toContain("COMPLETED");
        });
    });

    describe("CSV export (?format=csv)", () => {
        it("returns text/csv content type when format=csv", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history?format=csv`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/text\/csv/);
        });

        it("sets the correct Content-Disposition filename", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history?format=csv`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(res.headers["content-disposition"]).toContain(
                `trade-${TRADE_ID}-history.csv`
            );
        });

        it("CSV body contains the expected column headers", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history?format=csv`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            const firstLine = res.text.split("\n")[0];
            expect(firstLine).toContain("eventType");
            expect(firstLine).toContain("timestamp");
            expect(firstLine).toContain("actor");
            expect(firstLine).toContain("metadata");
        });

        it("CSV body contains one data row per event", async () => {
            mockGetTradeHistory.mockResolvedValue(mockEvents);

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history?format=csv`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            // header row + data rows (filter out any trailing empty line)
            const lines = res.text.split("\n").filter((l) => l.trim() !== "");
            expect(lines.length).toBe(mockEvents.length + 1); // +1 for header
        });

        it("returns 403 in CSV mode when caller is unauthorized", async () => {
            mockGetTradeHistory.mockRejectedValue(new AuditTrailAccessDeniedError());

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history?format=csv`)
                .set("Authorization", `Bearer ${makeToken(STRANGER)}`);

            expect(res.status).toBe(403);
        });
    });

    describe("server errors", () => {
        it("returns 500 for unexpected service errors", async () => {
            mockGetTradeHistory.mockRejectedValue(new Error("Database connection lost"));

            const res = await request(app)
                .get(`/trades/${TRADE_ID}/history`)
                .set("Authorization", `Bearer ${makeToken(BUYER)}`);

            expect(res.status).toBe(500);
            expect(res.body.error).toBe("Failed to retrieve trade history");
        });
    });
});

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
