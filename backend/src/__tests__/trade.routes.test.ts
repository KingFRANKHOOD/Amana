import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { tradeRoutes } from "../routes/trade.routes";
import { ContractService } from "../services/contract.service";
import { TradeService } from "../services/trade.service";

jest.mock("../services/contract.service");
jest.mock("../services/trade.service");

const app = express();
app.use(express.json());
app.use("/trades", tradeRoutes);

describe("Trade Routes", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;
  let sellerToken: string;

  beforeAll(() => {
    const secret = process.env.JWT_SECRET!;
    token = jwt.sign({ walletAddress: buyerAddress }, secret);
    sellerToken = jwt.sign({ walletAddress: sellerAddress }, secret);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 201 with tradeId and unsignedXdr for a valid request", async () => {
    (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockResolvedValue({
      tradeId: "4294967297",
      unsignedXdr: "AAAA-test-xdr",
    });
    (TradeService.prototype.createPendingTrade as jest.Mock).mockResolvedValue({
      tradeId: "4294967297",
    });

    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sellerAddress,
        amountUsdc: "125.1234567",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      tradeId: "4294967297",
      unsignedXdr: "AAAA-test-xdr",
    });
    expect(ContractService.prototype.buildCreateTradeTx).toHaveBeenCalledWith({
      buyerAddress,
      sellerAddress,
      amountUsdc: "125.1234567",
      buyerLossBps: expect.any(Number),
      sellerLossBps: expect.any(Number),
    });
    expect(TradeService.prototype.createPendingTrade).toHaveBeenCalledWith({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      buyerLossBps: expect.any(Number),
      sellerLossBps: expect.any(Number),
    });
  });

  it("returns 400 for an invalid sellerAddress", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sellerAddress: "not-a-stellar-address",
        amountUsdc: "10",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid sellerAddress");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/trades").send({
      sellerAddress,
      amountUsdc: "10",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns unsignedXdr for a valid buyer deposit request", async () => {
    (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: "CREATED",
    });
    (ContractService.prototype.buildDepositTx as jest.Mock).mockResolvedValue({
      unsignedXdr: "AAAA-deposit-xdr",
    });

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      unsignedXdr: "AAAA-deposit-xdr",
    });
    expect(TradeService.prototype.getTradeById).toHaveBeenCalledWith(
      "4294967297",
      buyerAddress
    );
    expect(ContractService.prototype.buildDepositTx).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "4294967297",
        buyerAddress: buyerAddress,
      })
    );
  });

  it("returns 403 if the caller is the seller", async () => {
    (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: "CREATED",
    });

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("returns 400 if the trade is already funded", async () => {
    (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: "FUNDED",
    });

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Trade must be in CREATED status");
  });
});
