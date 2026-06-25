import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createStrictReceivePaymentRouter } from "../routes/stellar.payment.strictReceive.js";

vi.mock("@stellar/stellar-sdk", () => {
  const mockAccount = {
    accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  };

  const mockAsset = {
    code: "XLM",
    issuer: null,
    getIssuer: () => null,
    getCode: () => "XLM",
    getAssetType: () => "native",
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
        return mockAsset;
      }
      constructor(public code: string, public issuer: string) {}
      getIssuer() { return this.issuer; }
      getCode() { return this.code; }
      getAssetType() { return "credit_alphanum4"; }
    },
    Memo: {
      text: (t: string) => ({ type: "text", value: t }),
    },
    Operation: {
      pathPaymentStrictReceive: vi.fn(() => ({ type: "pathPaymentStrictReceive" })),
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
  app.use("/stellar/payment", createStrictReceivePaymentRouter());
  return app;
}

describe("POST /stellar/payment/strict-receive", () => {
  const VALID_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const VALID_KEY2 = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  const validBody = {
    sourceAccount: VALID_KEY,
    destination: VALID_KEY2,
    destinationAmount: "100",
    sourceMax: "110",
    destinationAsset: {
      code: "USDC",
      issuer: VALID_KEY2,
    },
    path: [],
  };

  it("returns unsigned envelope for valid request", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("envelopeXDR");
    expect(res.body).toHaveProperty("networkPassphrase");
    expect(typeof res.body.envelopeXDR).toBe("string");
    expect(res.body.envelopeXDR.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid sourceAccount", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validBody, sourceAccount: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("details");
  });

  it("returns 400 for invalid destinationAmount", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validBody, destinationAmount: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Validation");
  });

  it("returns 400 for missing required fields", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ sourceAccount: VALID_KEY });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid path assets", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({
        ...validBody,
        path: [{ code: "", issuer: "invalid" }],
      });

    expect(res.status).toBe(400);
  });
});
