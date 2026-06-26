import express from "express";
import request from "supertest";
import { errorHandler } from "../middleware/errorHandler";
import { createContractStateRouter } from "../routes/contract.state.routes";
import { StellarError } from "../errors/service.errors";

const VALID_CONTRACT_ID = "C".padEnd(56, "A");

function buildApp(stellarService: { getContractTradeState: jest.Mock }) {
  const app = express();
  app.use(express.json());
  app.use("/contract", createContractStateRouter(stellarService as any));
  app.use(errorHandler);
  return app;
}

describe("GET /contract/:contractId/state", () => {
  it("returns decoded contract trade state as JSON", async () => {
    const state = {
      tradeId: "42",
      buyer: "GBUYER",
      seller: "GSELLER",
      amount: "10000000",
      status: "Created",
    };
    const stellarService = {
      getContractTradeState: jest.fn().mockResolvedValue(state),
    };

    const res = await request(buildApp(stellarService))
      .get(`/contract/${VALID_CONTRACT_ID}/state`)
      .query({ tradeId: "42" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      contractId: VALID_CONTRACT_ID,
      tradeId: "42",
      state,
    });
    expect(stellarService.getContractTradeState).toHaveBeenCalledWith(
      VALID_CONTRACT_ID,
      "42",
    );
  });

  it("returns 404 for invalid contract IDs", async () => {
    const stellarService = {
      getContractTradeState: jest.fn().mockRejectedValue(
        new StellarError({
          code: "STELLAR_INVALID_CONTRACT_ID",
          message: "Invalid Soroban contract ID",
          httpStatus: 404,
          retryable: false,
        }),
      ),
    };

    const res = await request(buildApp(stellarService))
      .get("/contract/not-a-contract/state")
      .query({ tradeId: "42" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("STELLAR_INVALID_CONTRACT_ID");
  });

  it("returns typed network errors from StellarService", async () => {
    const stellarService = {
      getContractTradeState: jest.fn().mockRejectedValue(
        new StellarError({
          code: "STELLAR_TIMEOUT",
          message: "Stellar service timed out",
          httpStatus: 504,
          retryable: true,
        }),
      ),
    };

    const res = await request(buildApp(stellarService))
      .get(`/contract/${VALID_CONTRACT_ID}/state`)
      .query({ tradeId: "42" });

    expect(res.status).toBe(504);
    expect(res.body.code).toBe("STELLAR_TIMEOUT");
    expect(res.body.details.retryable).toBe(true);
  });
});
