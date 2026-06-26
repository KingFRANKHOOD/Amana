import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createStrictSendPaymentRouter } from "../routes/stellar.payment.strictSend.js";

vi.mock("@stellar/stellar-sdk", () => {
  const mockAccount = {
    accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  };

  const mockTransactionBuilder = {
    addOperation: vi.fn().mockReturnThis(),
    addMemo: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: () => ({
      toEnvelope: () => ({
        toXDR: () => ({
          toString: () => "bW9ja2VkLXhlci1kYXRh",
        }),
      }),
    }),
  };

  return {
    Networks: {
      PUBLIC: "Public Global Stellar Network ; September 2015",
      TESTNET: "Test SDF Network ; September 2015",
    },
    BASE_FEE: "100",
    Asset: class MockAsset {
      static native() {
        return { code: "XLM", issuer: null };
      }
      constructor(public code: string, public issuer: string) {}
    },
    Memo: {
      text: (t: string) => ({ type: "text", value: t }),
    },
    Operation: {
      pathPaymentStrictSend: vi.fn(() => ({ type: "pathPaymentStrictSend" })),
    },
    TransactionBuilder: vi.fn(() => mockTransactionBuilder),
    Horizon: {
      Server: vi.fn(() => ({
        loadAccount: vi.fn().mockResolvedValue(mockAccount),
      })),
    },
  };
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/stellar/payment", createStrictSendPaymentRouter());
  return app;
}

describe("POST /stellar/payment/strict-send", () => {
  const VALID_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const VALID_KEY2 = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  const validBody = {
    sourceAccount: VALID_KEY,
    destination: VALID_KEY2,
    sourceAmount: "100",
    destinationMin: "95",
    destinationAsset: {
      code: "USDC",
      issuer: VALID_KEY2,
    },
    path: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unsigned envelope for valid request", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("envelopeXDR");
    expect(res.body).toHaveProperty("networkPassphrase");
    expect(typeof res.body.envelopeXDR).toBe("string");
    expect(res.body.envelopeXDR.length).toBeGreaterThan(0);
  });

  it("returns unsigned envelope when path contains intermediate assets", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({
        ...validBody,
        path: [{ code: "XLM", issuer: VALID_KEY }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("envelopeXDR");
  });

  it("returns 400 for slippage breach — destinationMin as non-numeric string", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validBody, destinationMin: "not-a-number" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Validation failed");
    expect(res.body).toHaveProperty("details");
  });

  it("returns 400 when sourceAmount is invalid", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validBody, sourceAmount: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Validation");
  });

  it("returns 400 when path has invalid asset", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({
        ...validBody,
        path: [{ code: "", issuer: "bad-key" }],
      });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ sourceAccount: VALID_KEY });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid sourceAccount key", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validBody, sourceAccount: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("details");
  });
});
