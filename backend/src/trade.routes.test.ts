import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { tradeRepository } from "./repositories/trade.repository";
import * as contractService from "./services/contract.service";

describe("POST /trades/:id/confirm and /release", () => {
  const app = createApp();
  let buyer: Keypair;
  let seller: Keypair;

  beforeEach(() => {
    buyer = Keypair.random();
    seller = Keypair.random();
    process.env.SOROBAN_RPC_URL = "http://127.0.0.1:8000/soroban/rpc";
    process.env.AMANA_ESCROW_CONTRACT_ID =
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    process.env.STELLAR_NETWORK_PASSPHRASE = Networks.FUTURENET;

    const mockServer = {
      getAccount: vi
        .fn()
        .mockImplementation(
          async (pk: string) => new Account(pk, "1"),
        ),
      prepareTransaction: vi.fn().mockImplementation(async (tx) => tx),
    } as unknown as rpc.Server;

    contractService.__setRpcServerFactoryForTests(() => mockServer);
    tradeRepository.clear();
  });

  afterEach(() => {
    contractService.__resetRpcServerFactoryForTests();
    tradeRepository.clear();
  });

  it("POST /trades/:id/confirm builds valid XDR for buyer", async () => {
    tradeRepository.upsert({
      id: "t1",
      chainTradeId: "99",
      buyerStellarAddress: buyer.publicKey(),
      sellerStellarAddress: seller.publicKey(),
      status: "FUNDED",
    });

    const res = await request(app)
      .post("/trades/t1/confirm")
      .set("X-Stellar-Address", buyer.publicKey())
      .expect(200);

    expect(res.body).toHaveProperty("unsignedXdr");
    expect(typeof res.body.unsignedXdr).toBe("string");

    const tx = TransactionBuilder.fromXDR(
      res.body.unsignedXdr,
      Networks.FUTURENET,
    );
    expect(tx).toBeDefined();
  });

  it("POST /trades/:id/confirm returns 403 for seller", async () => {
    tradeRepository.upsert({
      id: "t2",
      chainTradeId: "100",
      buyerStellarAddress: buyer.publicKey(),
      sellerStellarAddress: seller.publicKey(),
      status: "FUNDED",
    });

    await request(app)
      .post("/trades/t2/confirm")
      .set("X-Stellar-Address", seller.publicKey())
      .expect(403);
  });

  it("POST /trades/:id/release returns 400 if not in DELIVERED status", async () => {
    tradeRepository.upsert({
      id: "t3",
      chainTradeId: "101",
      buyerStellarAddress: buyer.publicKey(),
      sellerStellarAddress: seller.publicKey(),
      status: "FUNDED",
    });

    await request(app)
      .post("/trades/t3/release")
      .set("X-Stellar-Address", buyer.publicKey())
      .expect(400);
  });
});
