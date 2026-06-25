import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { createPaymentHistoryRouter } from "../routes/stellar.payments.js";

const mockRecords = [
  {
    id: "pay1",
    type: "payment",
    amount: "100.0000000",
    asset_type: "native",
    from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    created_at: "2026-06-23T12:00:00Z",
    paging_token: "token1",
    transaction: { memo: "test payment" },
  },
  {
    id: "pay2",
    type: "payment",
    amount: "50.0000000",
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    to: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    created_at: "2026-06-23T11:00:00Z",
    paging_token: "token2",
  },
];

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: vi.fn(() => ({
      payments: vi.fn().mockReturnThis(),
      forAccount: vi.fn().mockReturnThis(),
      cursor: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      call: vi.fn().mockResolvedValue({
        records: mockRecords,
      }),
    })),
  },
}));

function createApp() {
  const app = express();
  app.use("/stellar/account", createPaymentHistoryRouter());
  return app;
}

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("GET /stellar/account/:address/payments", () => {
  it("returns payment list for a valid account", async () => {
    const app = createApp();
    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/payments`);

    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.pagination.hasMore).toBeDefined();
    expect(res.body.pagination.limit).toBe(20);
  });

  it("parses native asset payments correctly", async () => {
    const app = createApp();
    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/payments`);

    const xlmPayment = res.body.payments.find((p: any) => p.asset.code === "XLM");
    expect(xlmPayment).toBeDefined();
    expect(xlmPayment.asset.issuer).toBeNull();
    expect(xlmPayment.amount).toBe("100.0000000");
    expect(xlmPayment.memo).toBe("test payment");
  });

  it("parses non-native asset payments correctly", async () => {
    const app = createApp();
    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/payments`);

    const usdcPayment = res.body.payments.find((p: any) => p.asset.code === "USDC");
    expect(usdcPayment).toBeDefined();
    expect(usdcPayment.asset.issuer).toBeTruthy();
    expect(usdcPayment.amount).toBe("50.0000000");
  });

  it("returns 400 for invalid address", async () => {
    const app = createApp();
    const res = await request(app).get("/stellar/account/invalid-address/payments");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid");
  });

  it("supports cursor pagination", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/stellar/account/${VALID_ADDRESS}/payments`)
      .query({ cursor: "token2" });

    expect(res.status).toBe(200);
    expect(res.body.payments).toBeDefined();
  });

  it("supports custom limit", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/stellar/account/${VALID_ADDRESS}/payments`)
      .query({ limit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
  });

  it("caps limit at 100", async () => {
    const app = createApp();
    const res = await request(app)
      .get(`/stellar/account/${VALID_ADDRESS}/payments`)
      .query({ limit: 200 });

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });
});
