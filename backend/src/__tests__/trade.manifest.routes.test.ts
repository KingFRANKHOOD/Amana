import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createTradeManifestRouter } from "../routes/trade.manifest.routes";
import { AuthService } from "../services/auth.service";
import { ServiceUnavailableError } from "../services/ipfs.service";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

describe("Trade manifest submission route", () => {
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;
  const manifestService = {
    submitManifest: jest.fn(),
    getManifestByTradeId: jest.fn(),
  };
  const contractService = {
    buildSubmitTradeManifestTx: jest.fn(),
  };
  const ipfsService = {
    uploadFile: jest.fn(),
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/trades/:id/manifest",
    createTradeManifestRouter(manifestService as any, contractService as any, ipfsService as any),
  );
  app.use(errorHandler);

  beforeAll(() => {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: sellerAddress,
        jti: "trade-manifest-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      process.env.JWT_SECRET!,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  const payload = {
    driverName: "Ada Driver",
    phone: "+2348012345678",
    licensePlate: "LAG-123XY",
    vehicleType: "Box truck",
    estimatedDeliveryWindow: {
      from: "2026-07-01T09:00:00.000Z",
      to: "2026-07-01T17:00:00.000Z",
    },
  };

  it("pins manifest JSON and returns IPFS hash plus unsigned XDR", async () => {
    ipfsService.uploadFile.mockResolvedValue("bafy-manifest");
    manifestService.submitManifest.mockResolvedValue({ manifestId: 77 });
    contractService.buildSubmitTradeManifestTx.mockResolvedValue({ unsignedXdr: "AAAA-manifest-xdr" });

    const res = await request(app)
      .post("/trades/4294967297/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      manifestId: 77,
      ipfsHash: "bafy-manifest",
      unsignedXdr: "AAAA-manifest-xdr",
    });
    expect(ipfsService.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "trade-4294967297-manifest.json",
    );
    expect(contractService.buildSubmitTradeManifestTx).toHaveBeenCalledWith({
      tradeId: "4294967297",
      sellerAddress,
      ipfsHash: "bafy-manifest",
    });
  });

  it("rejects missing required fields", async () => {
    const res = await request(app)
      .post("/trades/4294967297/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...payload, licensePlate: undefined });

    expect(res.status).toBe(400);
    expect(res.body.error).toHaveProperty("licensePlate");
    expect(ipfsService.uploadFile).not.toHaveBeenCalled();
  });

  it("returns a service error when IPFS pinning fails", async () => {
    ipfsService.uploadFile.mockRejectedValue(new ServiceUnavailableError("IPFS unavailable"));

    const res = await request(app)
      .post("/trades/4294967297/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("IPFS unavailable");
    expect(manifestService.submitManifest).not.toHaveBeenCalled();
    expect(contractService.buildSubmitTradeManifestTx).not.toHaveBeenCalled();
  });
});
