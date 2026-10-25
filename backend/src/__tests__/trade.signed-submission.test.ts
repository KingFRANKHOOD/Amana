import * as StellarSdk from "@stellar/stellar-sdk";
import type { NextFunction, Response } from "express";
import { env } from "../config/env";
import { networkPassphrase } from "../config/stellar";
import { TradeController } from "../controllers/trade.controller";
import type { TradeService } from "../services/trade.service";
import type { ContractService } from "../services/contract.service";
import type { StellarService } from "../services/stellar.service";

const TRADE_ID = "42";
const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));

function signedTradeXdr(keypair: StellarSdk.Keypair, functionName: string): string {
  const args = [StellarSdk.nativeToScVal(BigInt(TRADE_ID), { type: "u64" })];
  if (functionName === "release_funds") {
    args.push(StellarSdk.Address.fromString(keypair.publicKey()).toScVal());
  }
  const transaction = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(keypair.publicKey(), "1"),
    { fee: StellarSdk.BASE_FEE, networkPassphrase },
  )
    .addOperation(
      new StellarSdk.Contract(contractId).call(functionName, ...args),
    )
    .setTimeout(30)
    .build();
  transaction.sign(keypair);
  return transaction.toXDR();
}

describe("signed trade transaction submission", () => {
  it("submits a signed deposit invocation from the authenticated buyer", async () => {
    const buyer = StellarSdk.Keypair.random();
    env.AMANA_ESCROW_CONTRACT_ID = contractId;
    const tradeService = {
      getTradeById: jest.fn().mockResolvedValue({
        tradeId: TRADE_ID,
        buyerAddress: buyer.publicKey(),
        sellerAddress: StellarSdk.Keypair.random().publicKey(),
      }),
    };
    const stellarService = {
      submitTransaction: jest.fn().mockResolvedValue({
        hash: "transaction-hash",
        status: "PENDING",
      }),
    };
    const controller = new TradeController(
      tradeService as unknown as TradeService,
      {} as ContractService,
      stellarService as unknown as StellarService,
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    await controller.submitSignedTransaction(
      {
        params: { id: TRADE_ID },
        body: { signedXdr: signedTradeXdr(buyer, "deposit") },
        user: { walletAddress: buyer.publicKey() },
      } as never,
      response,
      next,
    );

    expect(stellarService.submitTransaction).toHaveBeenCalledWith(
      expect.any(String),
    );
    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({
      hash: "transaction-hash",
      status: "PENDING",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("submits a signed release invocation only for the authenticated source address", async () => {
    const buyer = StellarSdk.Keypair.random();
    env.AMANA_ESCROW_CONTRACT_ID = contractId;
    const tradeService = {
      getTradeById: jest.fn().mockResolvedValue({
        tradeId: TRADE_ID,
        buyerAddress: buyer.publicKey(),
        sellerAddress: StellarSdk.Keypair.random().publicKey(),
      }),
    };
    const stellarService = {
      submitTransaction: jest.fn().mockResolvedValue({
        hash: "release-hash",
        status: "PENDING",
      }),
    };
    const controller = new TradeController(
      tradeService as unknown as TradeService,
      {} as ContractService,
      stellarService as unknown as StellarService,
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    await controller.submitSignedTransaction(
      {
        params: { id: TRADE_ID },
        body: { signedXdr: signedTradeXdr(buyer, "release_funds") },
        user: { walletAddress: buyer.publicKey() },
      } as never,
      response,
      next,
    );

    expect(stellarService.submitTransaction).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(202);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a signed transaction whose source does not match the authenticated wallet", async () => {
    const buyer = StellarSdk.Keypair.random();
    const otherAccount = StellarSdk.Keypair.random();
    env.AMANA_ESCROW_CONTRACT_ID = contractId;
    const tradeService = {
      getTradeById: jest.fn().mockResolvedValue({
        tradeId: TRADE_ID,
        buyerAddress: buyer.publicKey(),
        sellerAddress: StellarSdk.Keypair.random().publicKey(),
      }),
    };
    const stellarService = { submitTransaction: jest.fn() };
    const controller = new TradeController(
      tradeService as unknown as TradeService,
      {} as ContractService,
      stellarService as unknown as StellarService,
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    await controller.submitSignedTransaction(
      {
        params: { id: TRADE_ID },
        body: { signedXdr: signedTradeXdr(otherAccount, "deposit") },
        user: { walletAddress: buyer.publicKey() },
      } as never,
      response,
      next,
    );

    expect(stellarService.submitTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
