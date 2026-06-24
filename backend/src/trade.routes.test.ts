import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import request from "supertest";

jest.mock("./services/trade.service", () => {
  const { tradeRepository } = require("./repositories/trade.repository");
  return {
    TradeAccessDeniedError: class extends Error {
      constructor() {
        super("Forbidden");
        this.name = "TradeAccessDeniedError";
      }
    },
    TradeService: jest.fn().mockImplementation(() => ({
      getTradeById: jest.fn().mockImplementation(async (id: string, caller: string) => {
        const trade = tradeRepository.getById(id);
        if (!trade) return null;
        const c = caller.toLowerCase();
        if (trade.buyerAddress.toLowerCase() !== c && trade.sellerAddress.toLowerCase() !== c) {
          throw new (require("./services/trade.service").TradeAccessDeniedError)();
        }
        return trade;
      }),
    })),
  };
});

import { tradeRepository } from "./repositories/trade.repository";
import { createApp } from "./app";
import * as contractService from "./services/contract.service";
import { AuthHelper } from "./lib/authHelper";
import { AppError, ErrorCode } from "./errors/errorCodes";

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

    jest.spyOn(AuthHelper, "authenticateRequest").mockImplementation(async (req: any) => {
      const stellarAddress = req.header("X-Stellar-Address");
      if (stellarAddress) {
        return {
          user: {
            sub: stellarAddress.toLowerCase(),
            walletAddress: stellarAddress.toLowerCase(),
            jti: "test-jti",
          },
        };
      }
      return {
        error: new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401),
      };
    });

    const mockServer = {
      getAccount: jest
        .fn()
        .mockImplementation(
          async (pk: string) => new Account(pk, "1"),
        ),
      prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
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
      id: 1,
      tradeId: "t1",
      buyerAddress: buyer.publicKey(),
      sellerAddress: seller.publicKey(),
      amountUsdc: "100",
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
      id: 2,
      tradeId: "t2",
      buyerAddress: buyer.publicKey(),
      sellerAddress: seller.publicKey(),
      amountUsdc: "100",
      status: "FUNDED",
    });

    await request(app)
      .post("/trades/t2/confirm")
      .set("X-Stellar-Address", seller.publicKey())
      .expect(403);
  });

  it("POST /trades/:id/release returns 400 if not in DELIVERED status", async () => {
    tradeRepository.upsert({
      id: 3,
      tradeId: "t3",
      buyerAddress: buyer.publicKey(),
      sellerAddress: seller.publicKey(),
      amountUsdc: "100",
      status: "FUNDED",
    });

    await request(app)
      .post("/trades/t3/release")
      .set("X-Stellar-Address", buyer.publicKey())
      .expect(400);
  });
});
