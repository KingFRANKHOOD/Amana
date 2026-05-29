/**
 * Issue #233: Comprehensive input validation tests
 *
 * Covers: Stellar addresses, USDC amounts, loss ratios (bps),
 * delivery days, driver manifest dates, and string fields.
 */

import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../services/contract.service");
jest.mock("../services/trade.service");
jest.mock("../services/manifest.service");
jest.mock("../services/auth.service", () => {
  return {
    AuthService: {
      validateToken: jest.fn(async (token: string) => {
        const jwt = require("jsonwebtoken");
        return jwt.decode(token);
      }),
      isTokenRevoked: jest.fn().mockResolvedValue(false),
    },
  };
});

import { ContractService } from "../services/contract.service";
import { TradeService } from "../services/trade.service";
import { ManifestService } from "../services/manifest.service";
import { AuthService } from "../services/auth.service";
import { tradeRoutes } from "../routes/trade.routes";
import { createManifestRouter } from "../routes/manifest.routes";

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/trades", tradeRoutes);

// Mount manifest router under /trades/:id/manifest
const manifestApp = express();
manifestApp.use(express.json());
const manifestRouter = createManifestRouter(
  new ManifestService() as jest.Mocked<ManifestService>,
  new ContractService() as jest.Mocked<ContractService>,
);
manifestApp.use("/trades/:id/manifest", manifestRouter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-at-least-32-characters-long";
const JWT_ISSUER = "amana";
const JWT_AUDIENCE = "amana-api";

function makeToken(walletAddress: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti: `jti-${Math.random()}`,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      nbf: now - 1,
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

const validBuyer = StellarSdk.Keypair.random().publicKey();
const validSeller = StellarSdk.Keypair.random().publicKey();
const buyerToken = makeToken(validBuyer);

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = JWT_ISSUER;
  process.env.JWT_AUDIENCE = JWT_AUDIENCE;
});

beforeEach(() => {
  jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Stellar Address Validation ───────────────────────────────────────────────

describe("Stellar address validation", () => {
  const validPayload = {
    sellerAddress: validSeller,
    amountUsdc: "100",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
  };

  beforeEach(() => {
    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: "1",
      unsignedXdr: "xdr",
    });
    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({ tradeId: "1" });
  });

  it("accepts a valid 56-char G... Stellar address", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send(validPayload);
    expect(res.status).toBe(201);
  });

  it("rejects address that is too short", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "GABC123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sellerAddress/i);
  });

  it("rejects address with wrong prefix (not G)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "SABC" + "A".repeat(52) });
    expect(res.status).toBe(400);
  });

  it("rejects address with special characters", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "G@BC" + "A".repeat(52) });
    expect(res.status).toBe(400);
  });

  it("rejects non-base32 characters in address", async () => {
    // Base32 alphabet excludes 0, 1, 8, 9
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "G000" + "0".repeat(52) });
    expect(res.status).toBe(400);
  });

  it("rejects empty string address", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "" });
    expect(res.status).toBe(400);
  });

  it("rejects null address", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: null });
    expect(res.status).toBe(400);
  });

  it("rejects undefined address (missing field)", async () => {
    const { sellerAddress: _omit, ...rest } = validPayload;
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send(rest);
    expect(res.status).toBe(400);
  });

  it("rejects numeric address", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: 12345678901234567890 });
    expect(res.status).toBe(400);
  });

  it("rejects address that is too long (57+ chars)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...validPayload, sellerAddress: "G" + "A".repeat(56) });
    expect(res.status).toBe(400);
  });
});

// ─── USDC Amount Validation ───────────────────────────────────────────────────

describe("USDC amount validation", () => {
  const base = {
    sellerAddress: validSeller,
    buyerLossBps: 5000,
    sellerLossBps: 5000,
  };

  beforeEach(() => {
    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: "1",
      unsignedXdr: "xdr",
    });
    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({ tradeId: "1" });
  });

  it("accepts a positive integer amount", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "100" });
    expect(res.status).toBe(201);
  });

  it("accepts a positive decimal amount (up to 7 decimals)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "100.1234567" });
    expect(res.status).toBe(201);
  });

  it("rejects negative amount", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "-100" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amountUsdc/i);
  });

  it("rejects zero amount", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "0" });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric string 'abc'", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "abc" });
    expect(res.status).toBe(400);
  });

  it("rejects null amount", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: null });
    expect(res.status).toBe(400);
  });

  it("rejects undefined amount (missing field)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base });
    expect(res.status).toBe(400);
  });

  it("rejects amount with 8+ decimal places", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "100.123456789" });
    expect(res.status).toBe(400);
  });

  it("rejects mixed alphanumeric '100x'", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "100x" });
    expect(res.status).toBe(400);
  });

  it("accepts large valid amount (1 billion USDC)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "1000000000" });
    expect(res.status).toBe(201);
  });

  it("rejects amount '0.0' (effectively zero)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: "0.0" });
    expect(res.status).toBe(400);
  });
});

// ─── Loss Ratio (bps) Validation ─────────────────────────────────────────────

describe("Loss ratio (bps) validation", () => {
  const base = {
    sellerAddress: validSeller,
    amountUsdc: "100",
  };

  beforeEach(() => {
    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: "1",
      unsignedXdr: "xdr",
    });
    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({ tradeId: "1" });
  });

  it("accepts valid 50/50 split", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 5000, sellerLossBps: 5000 });
    expect(res.status).toBe(201);
  });

  it("accepts valid 0/10000 split (seller bears all)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 0, sellerLossBps: 10000 });
    expect(res.status).toBe(201);
  });

  it("accepts valid 10000/0 split (buyer bears all)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 10000, sellerLossBps: 0 });
    expect(res.status).toBe(201);
  });

  it("rejects negative buyerLossBps", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: -1000, sellerLossBps: 11000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/buyerLossBps/i);
  });

  it("rejects buyerLossBps > 10000", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 10001, sellerLossBps: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects sum > 10000 (5001 + 5001)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 5001, sellerLossBps: 5001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum/i);
  });

  it("rejects sum < 10000 (3000 + 3000)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 3000, sellerLossBps: 3000 });
    expect(res.status).toBe(400);
  });

  it("rejects non-integer bps (float)", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: 5000.5, sellerLossBps: 4999.5 });
    expect(res.status).toBe(400);
  });

  it("rejects string bps values", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: "5000", sellerLossBps: "5000" });
    expect(res.status).toBe(400);
  });

  it("rejects null bps", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, buyerLossBps: null, sellerLossBps: 10000 });
    expect(res.status).toBe(400);
  });
});

// ─── Driver Manifest Date Validation ─────────────────────────────────────────

describe("Driver manifest date validation", () => {
  const manifestToken = makeToken(validSeller);

  beforeEach(() => {
    (ManifestService.prototype.submitManifest as jest.Mock).mockResolvedValue({
      manifestId: 1,
      driverNameHash: "abc",
      driverIdHash: "def",
    });
    (ContractService.prototype.buildSubmitManifestTx as jest.Mock).mockResolvedValue({
      unsignedXdr: "xdr",
    });
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
  });

  const validManifestBody = {
    driverName: "John Driver",
    driverIdNumber: "DRV-001",
    vehicleRegistration: "ABC-1234",
    routeDescription: "Lagos to Abuja",
    expectedDeliveryAt: new Date(Date.now() + 86400000).toISOString(), // tomorrow
  };

  it("accepts a valid future ISO8601 date", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send(validManifestBody);
    expect(res.status).toBe(201);
  });

  it("rejects non-ISO8601 date string", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, expectedDeliveryAt: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects plain date without time component", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, expectedDeliveryAt: "2026-12-01" });
    expect(res.status).toBe(400);
  });

  it("rejects null expectedDeliveryAt", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, expectedDeliveryAt: null });
    expect(res.status).toBe(400);
  });

  it("rejects missing expectedDeliveryAt", async () => {
    const { expectedDeliveryAt: _omit, ...rest } = validManifestBody;
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send(rest);
    expect(res.status).toBe(400);
  });

  it("rejects numeric timestamp as date", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, expectedDeliveryAt: Date.now() });
    expect(res.status).toBe(400);
  });
});

// ─── String Field Validation ──────────────────────────────────────────────────

describe("String field validation (manifest)", () => {
  const manifestToken = makeToken(validSeller);

  beforeEach(() => {
    (ManifestService.prototype.submitManifest as jest.Mock).mockResolvedValue({
      manifestId: 1,
      driverNameHash: "abc",
      driverIdHash: "def",
    });
    (ContractService.prototype.buildSubmitManifestTx as jest.Mock).mockResolvedValue({
      unsignedXdr: "xdr",
    });
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
  });

  const validManifestBody = {
    driverName: "John Driver",
    driverIdNumber: "DRV-001",
    vehicleRegistration: "ABC-1234",
    routeDescription: "Lagos to Abuja",
    expectedDeliveryAt: new Date(Date.now() + 86400000).toISOString(),
  };

  it("rejects empty driverName", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, driverName: "" });
    expect(res.status).toBe(400);
  });

  it("rejects null driverName", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, driverName: null });
    expect(res.status).toBe(400);
  });

  it("rejects missing driverIdNumber", async () => {
    const { driverIdNumber: _omit, ...rest } = validManifestBody;
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send(rest);
    expect(res.status).toBe(400);
  });

  it("rejects empty vehicleRegistration", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, vehicleRegistration: "" });
    expect(res.status).toBe(400);
  });

  it("rejects empty routeDescription", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, routeDescription: "" });
    expect(res.status).toBe(400);
  });

  it("accepts driverName with special characters (SQL metacharacters escaped by ORM)", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, driverName: "O'Brien; DROP TABLE--" });
    // Validation layer should accept it (ORM handles escaping); service mock returns 201
    expect(res.status).toBe(201);
  });

  it("accepts driverName with unicode characters", async () => {
    const res = await request(manifestApp)
      .post("/trades/trade-1/manifest")
      .set("Authorization", `Bearer ${manifestToken}`)
      .send({ ...validManifestBody, driverName: "Ọlúwafẹ́mi Adéyẹmí" });
    expect(res.status).toBe(201);
  });
});

// ─── Type coercion edge cases ─────────────────────────────────────────────────

describe("Type coercion edge cases", () => {
  const base = {
    sellerAddress: validSeller,
    buyerLossBps: 5000,
    sellerLossBps: 5000,
  };

  beforeEach(() => {
    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: "1",
      unsignedXdr: "xdr",
    });
    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({ tradeId: "1" });
  });

  it("accepts numeric amountUsdc coerced to string '100'", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: 100 });
    // Controller normalizes number → string
    expect(res.status).toBe(201);
  });

  it("rejects amountUsdc as boolean", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: true });
    expect(res.status).toBe(400);
  });

  it("rejects amountUsdc as array", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: [100] });
    expect(res.status).toBe(400);
  });

  it("rejects amountUsdc as object", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ ...base, amountUsdc: { value: 100 } });
    expect(res.status).toBe(400);
  });
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("Auth guard on trade creation", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/trades")
      .send({ sellerAddress: validSeller, amountUsdc: "100", buyerLossBps: 5000, sellerLossBps: 5000 });
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed token", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", "Bearer not.a.valid.jwt")
      .send({ sellerAddress: validSeller, amountUsdc: "100", buyerLossBps: 5000, sellerLossBps: 5000 });
    expect(res.status).toBe(401);
  });
});
