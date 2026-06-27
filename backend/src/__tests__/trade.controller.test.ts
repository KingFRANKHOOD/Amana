import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { tradeRoutes } from "../routes/trade.routes";
import { TradeAccessDeniedError, DisputeTradeStatusError } from "../services/trade.service";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/errorCodes";

jest.mock("../services/trade.service", () => {
  mockTradeService = { createPendingTrade: jest.fn(), listUserTrades: jest.fn(), getTradeById: jest.fn(), getUserStats: jest.fn(), initiateDispute: jest.fn() };
  class MockTradeAccessDenied extends Error { constructor() { super("Forbidden"); this.name = "TradeAccessDeniedError"; } }
  class MockDisputeStatusError extends Error { status = 400; constructor() { super("Dispute status error"); this.name = "DisputeTradeStatusError"; } }
  class MockDisputeCategoryError extends Error { status = 400; constructor(cat: any) { super(`Invalid dispute category: ${cat}`); this.name = "DisputeCategoryValidationError"; } }
  return { TradeService: jest.fn(() => mockTradeService), TradeAccessDeniedError: MockTradeAccessDenied, DisputeTradeStatusError: MockDisputeStatusError, DisputeCategoryValidationError: MockDisputeCategoryError };
});

const app = express();
app.use(express.json());
app.use("/trades", tradeRoutes);
app.use(errorHandler);

describe("TradeController", () => {
    const buyerAddress = StellarSdk.Keypair.random().publicKey();
    const sellerAddress = StellarSdk.Keypair.random().publicKey();
    const strangerAddress = StellarSdk.Keypair.random().publicKey();
    let token: string;
    let sellerToken: string;
    let strangerToken: string;

    beforeAll(() => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
        process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
        process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
        const secret = process.env.JWT_SECRET!;
        const now = Math.floor(Date.now() / 1000);
        token = jwt.sign(
            {
                walletAddress: buyerAddress,
                jti: "trade-controller-buyer-jti",
                iss: process.env.JWT_ISSUER,
                aud: process.env.JWT_AUDIENCE,
                nbf: now - 1,
            },
            secret,
            { algorithm: "HS256" },
        );
        sellerToken = jwt.sign(
            {
                walletAddress: sellerAddress,
                jti: "trade-controller-seller-jti",
                iss: process.env.JWT_ISSUER,
                aud: process.env.JWT_AUDIENCE,
                nbf: now - 1,
            },
            secret,
            { algorithm: "HS256" },
        );
        strangerToken = jwt.sign(
            {
                walletAddress: strangerAddress,
                jti: "trade-controller-stranger-jti",
                iss: process.env.JWT_ISSUER,
                aud: process.env.JWT_AUDIENCE,
                nbf: now - 1,
            },
            secret,
            { algorithm: "HS256" },
        );
        jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("createTrade()", () => {
        it("returns 201 with tradeId and unsignedXdr for a valid request", async () => {
            (mockContractService.buildCreateTradeTx as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                unsignedXdr: "AAAA-test-xdr",
            });
            (mockTradeService.createPendingTrade as jest.Mock).mockResolvedValue({
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
            expect(mockContractService.buildCreateTradeTx).toHaveBeenCalledWith({
                buyerAddress,
                sellerAddress,
                amountUsdc: "125.1234567",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });
            expect(mockTradeService.createPendingTrade).toHaveBeenCalledWith({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });
        });

        it("validates seller address format — returns structured VALIDATION_ERROR", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress: "not-a-stellar-address",
                    amountUsdc: "10",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("validates USDC amount parsing — schema rejects invalid format", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "invalid-amount",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("validates buyerLossBps bounds (0-10000) — schema rejects out-of-range", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "100",
                    buyerLossBps: 10001,
                    sellerLossBps: 0,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("validates sellerLossBps bounds (0-10000) — schema rejects out-of-range", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "100",
                    buyerLossBps: 0,
                    sellerLossBps: 10001,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("validates buyerLossBps and sellerLossBps sum to 10000 — schema superRefine rejects", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "100",
                    buyerLossBps: 3000,
                    sellerLossBps: 3000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("handles negative amounts — schema regex rejects", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "-100",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("handles zero amounts — returns structured VALIDATION_ERROR", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "0",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades").send({
                sellerAddress,
                amountUsdc: "10",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });

        it("does not create a pending trade when contract build fails — structured TRADE_BUILD_FAILED", async () => {
            (mockContractService.buildCreateTradeTx as jest.Mock).mockRejectedValue(                new Error("simulate failed"),
            );

            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "125.1234567",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(500);
            expect(res.body.code).toBe(ErrorCode.TRADE_BUILD_FAILED);
            expect(mockTradeService.createPendingTrade).not.toHaveBeenCalled();        });
    });

    describe("buildDepositTx()", () => {
        it("returns unsignedXdr for a valid buyer deposit request", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });
            (mockContractService.buildDepositTx as jest.Mock).mockResolvedValue({
                unsignedXdr: "AAAA-deposit-xdr",
            });

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unsignedXdr: "AAAA-deposit-xdr" });
            expect(mockTradeService.getTradeById).toHaveBeenCalledWith("4294967297", buyerAddress);
            expect(mockContractService.buildDepositTx).toHaveBeenCalledWith(
                expect.objectContaining({ tradeId: "4294967297", buyerAddress }),
            );
        });

        it("returns 403 structured error if the caller is the seller", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe(ErrorCode.TRADE_ACCESS_DENIED);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 403 structured error if the caller is a stranger", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe(ErrorCode.TRADE_ACCESS_DENIED);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 400 structured error if the trade is already funded", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
            expect(res.body.details).toHaveProperty("currentStatus", "FUNDED");
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 404 structured error if trade not found", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue(null);
            const res = await request(app)
                .post("/trades/9999999999/deposit")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe(ErrorCode.TRADE_NOT_FOUND);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/deposit");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("confirmDelivery()", () => {
        it("returns unsignedXdr for a valid buyer confirm delivery request", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });
            (mockBuildConfirmDeliveryTx as jest.Mock).mockResolvedValue(
                "AAAA-confirm-delivery-xdr",            );

            const res = await request(app)
                .post("/trades/4294967297/confirm")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unsignedXdr: "AAAA-confirm-delivery-xdr" });
        });

        it("returns 403 structured error if the caller is the seller", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/confirm")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe(ErrorCode.TRADE_ACCESS_DENIED);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 400 structured error if the trade is not FUNDED", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });

            const res = await request(app)
                .post("/trades/4294967297/confirm")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
            expect(res.body.details).toHaveProperty("currentStatus", "CREATED");
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 404 structured error if trade not found", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue(null);
            const res = await request(app)
                .post("/trades/9999999999/confirm")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe(ErrorCode.TRADE_NOT_FOUND);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/confirm");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("releaseFunds()", () => {
        it("returns unsignedXdr for a valid buyer release funds request", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DELIVERED",
            });
            (mockBuildReleaseFundsTx as jest.Mock).mockResolvedValue(
                "AAAA-release-funds-xdr",            );

            const res = await request(app)
                .post("/trades/4294967297/release")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unsignedXdr: "AAAA-release-funds-xdr" });
        });

        it("returns 403 structured error if the caller is the seller", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DELIVERED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe(ErrorCode.TRADE_ACCESS_DENIED);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 400 structured error if the trade is not DELIVERED", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
            expect(res.body.details).toHaveProperty("currentStatus", "FUNDED");
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 400 structured error if trade is DISPUTED", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DISPUTED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
            expect(res.body.details).toHaveProperty("currentStatus", "DISPUTED");
        });

        it("returns 404 structured error if trade not found", async () => {
            (mockTradeService.getTradeById as jest.Mock).mockResolvedValue(null);
            const res = await request(app)
                .post("/trades/9999999999/release")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe(ErrorCode.TRADE_NOT_FOUND);
            expect(res.body.timestamp).toBeDefined();
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/release");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("initiateDispute()", () => {
        it("returns unsignedXdr for a valid dispute initiation", async () => {
            (mockTradeService.initiateDispute as jest.Mock).mockResolvedValue({
                unsignedXdr: "AAAA-dispute-xdr",
            });

            const res = await request(app)
                .post("/trades/4294967297/dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ unsignedXdr: "AAAA-dispute-xdr" });
            expect(mockTradeService.initiateDispute).toHaveBeenCalledWith(                "4294967297",
                buyerAddress,
                "Goods not as described",
                "quality",
                undefined,
            );
        });

        it("validates reason string is required — schema validation error", async () => {
            const res = await request(app)
                .post("/trades/4294967297/dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({ category: "quality" });

            expect(res.status).toBe(400);
            // Schema-level validation returns { error: message } format
            expect(res.body.error).toBeDefined();
        });

        it("returns 404 structured error if trade not found", async () => {
            (mockTradeService.initiateDispute as jest.Mock).mockRejectedValue(
                new Error("Trade not found"),
            );

            const res = await request(app)
                .post("/trades/9999999999/dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({ reason: "Goods not as described", category: "quality" });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe(ErrorCode.TRADE_NOT_FOUND);
            expect(res.body.timestamp).toBeDefined();        });

        it("returns 401 without auth", async () => {
            const res = await request(app)
                .post("/trades/4294967297/dispute")
                .send({ reason: "Goods not as described", category: "quality" });
            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("error cases", () => {
        it("handles invalid Stellar address in createTrade", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress: "INVALID",
                    amountUsdc: "100",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("handles negative amounts in createTrade", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    sellerAddress,
                    amountUsdc: "-100",
                    buyerLossBps: 5000,
                    sellerLossBps: 5000,
                });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
        });

        it("handles unauthorized access in buildDepositTx", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockRejectedValue(
                new Error("Access denied")
            );

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Forbidden");
        });

        it("handles trade not found in confirmDelivery", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post("/trades/9999999999/confirm-delivery")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("handles business logic violations in releaseFunds", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DISPUTED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release-funds")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Trade must be DELIVERED to release funds (current: DISPUTED)");
        });

        it("handles invalid trade ID format", async () => {
            const res = await request(app)
                .post("/trades/invalid-id/deposit")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Trade id is required");
        });
    });

    describe("authorization middleware", () => {
        it("enforces auth on all endpoints — all return 401", async () => {
            const endpoints = [
                { method: "post", path: "/trades" },
                { method: "post", path: "/trades/4294967297/deposit" },
                { method: "post", path: "/trades/4294967297/confirm" },
                { method: "post", path: "/trades/4294967297/release" },
                { method: "post", path: "/trades/4294967297/dispute" },
                { method: "get", path: "/trades" },
                { method: "get", path: "/trades/4294967297" },
            ];

            for (const endpoint of endpoints) {
                const res = await (request(app) as any)[endpoint.method](endpoint.path);
                expect(res.status).toBe(401);
                expect(res.body.error).toBe("Unauthorized");
            }
        });
    });

    describe("error payload structure", () => {
        it("every error response includes code, message, details, and timestamp", async () => {
            const res = await request(app)
                .post("/trades")
                .set("Authorization", `Bearer ${token}`)
                .send({ sellerAddress: "bad", amountUsdc: "1", buyerLossBps: 5000, sellerLossBps: 5000 });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty("code");
            expect(res.body).toHaveProperty("message");
            expect(res.body).toHaveProperty("details");
            expect(res.body).toHaveProperty("timestamp");
            expect(typeof res.body.timestamp).toBe("string");
        });
    });
});
