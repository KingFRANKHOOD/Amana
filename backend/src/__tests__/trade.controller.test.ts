import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { tradeRoutes } from "../routes/trade.routes";
import { ContractService } from "../services/contract.service";
import { TradeService } from "../services/trade.service";
import { AuthService } from "../services/auth.service";

jest.mock("../services/contract.service");
jest.mock("../services/trade.service");

const app = express();
app.use(express.json());
app.use("/trades", tradeRoutes);

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
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });
            expect(TradeService.prototype.createPendingTrade).toHaveBeenCalledWith({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });
        });

        it("validates seller address format", async () => {
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
            expect(res.body.error).toBe("Invalid sellerAddress");
        });

        it("validates USDC amount parsing", async () => {
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
            expect(res.body.error).toBe("Invalid amountUsdc");
        });

        it("validates buyerLossBps bounds (0-10000)", async () => {
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
            expect(res.body.error).toBe("buyerLossBps must be an integer between 0 and 10000");
        });

        it("validates sellerLossBps bounds (0-10000)", async () => {
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
            expect(res.body.error).toBe("sellerLossBps must be an integer between 0 and 10000");
        });

        it("validates buyerLossBps and sellerLossBps sum to 10000", async () => {
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
            expect(res.body.error).toBe("buyerLossBps and sellerLossBps must sum to 10000");
        });

        it("handles negative amounts", async () => {
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
            expect(res.body.error).toBe("Invalid amountUsdc");
        });

        it("handles zero amounts", async () => {
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
            expect(res.body.error).toBe("Invalid amountUsdc");
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

        it("does not create a pending trade when create_trade contract build fails", async () => {
            (ContractService.prototype.buildCreateTradeTx as jest.Mock).mockRejectedValue(
                new Error("simulate failed"),
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
            expect(TradeService.prototype.createPendingTrade).not.toHaveBeenCalled();
        });
    });

    describe("buildDepositTx()", () => {
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

        it("returns 403 if the caller is a stranger", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });

            const res = await request(app)
                .post("/trades/4294967297/deposit")
                .set("Authorization", `Bearer ${strangerToken}`);

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

        it("returns 404 if trade not found", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post("/trades/9999999999/deposit")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/deposit");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("confirmDelivery()", () => {
        it("returns unsignedXdr for a valid buyer confirm delivery request", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });
            (ContractService.buildConfirmDeliveryTx as jest.Mock).mockResolvedValue(
                "AAAA-confirm-delivery-xdr"
            );

            const res = await request(app)
                .post("/trades/4294967297/confirm-delivery")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                unsignedXdr: "AAAA-confirm-delivery-xdr",
            });
            expect(TradeService.prototype.getTradeById).toHaveBeenCalledWith(
                "4294967297",
                buyerAddress
            );
            expect(ContractService.buildConfirmDeliveryTx).toHaveBeenCalledWith(
                expect.objectContaining({
                    tradeId: "4294967297",
                    buyerAddress: buyerAddress,
                }),
                buyerAddress
            );
        });

        it("returns 403 if the caller is the seller", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/confirm-delivery")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Only the buyer may confirm delivery");
        });

        it("returns 403 if the caller is a stranger", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/confirm-delivery")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Only the buyer may confirm delivery");
        });

        it("returns 400 if the trade is not FUNDED", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
            });

            const res = await request(app)
                .post("/trades/4294967297/confirm-delivery")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Trade must be FUNDED to confirm delivery (current: CREATED)");
        });

        it("returns 404 if trade not found", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post("/trades/9999999999/confirm-delivery")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/confirm-delivery");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("releaseFunds()", () => {
        it("returns unsignedXdr for a valid buyer release funds request", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DELIVERED",
            });
            (ContractService.buildReleaseFundsTx as jest.Mock).mockResolvedValue(
                "AAAA-release-funds-xdr"
            );

            const res = await request(app)
                .post("/trades/4294967297/release-funds")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                unsignedXdr: "AAAA-release-funds-xdr",
            });
            expect(TradeService.prototype.getTradeById).toHaveBeenCalledWith(
                "4294967297",
                buyerAddress
            );
            expect(ContractService.buildReleaseFundsTx).toHaveBeenCalledWith(
                expect.objectContaining({
                    tradeId: "4294967297",
                    buyerAddress: buyerAddress,
                }),
                buyerAddress
            );
        });

        it("returns 403 if the caller is the seller", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DELIVERED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release-funds")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Only the buyer or an admin may release funds");
        });

        it("returns 403 if the caller is a stranger", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "DELIVERED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release-funds")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Only the buyer or an admin may release funds");
        });

        it("returns 400 if the trade is not DELIVERED", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "FUNDED",
            });

            const res = await request(app)
                .post("/trades/4294967297/release-funds")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Trade must be DELIVERED to release funds (current: FUNDED)");
        });

        it("returns 404 if trade not found", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post("/trades/9999999999/release-funds")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).post("/trades/4294967297/release-funds");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("initiateDispute()", () => {
        it("returns unsignedXdr for a valid dispute initiation", async () => {
            (TradeService.prototype.initiateDispute as jest.Mock).mockResolvedValue({
                unsignedXdr: "AAAA-initiate-dispute-xdr",
            });

            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                unsignedXdr: "AAAA-initiate-dispute-xdr",
            });
            expect(TradeService.prototype.initiateDispute).toHaveBeenCalledWith(
                "4294967297",
                buyerAddress,
                "Goods not as described",
                "quality"
            );
        });

        it("validates reason string is required", async () => {
            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    category: "quality",
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Reason string is required");
        });

        it("validates category string is required", async () => {
            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    reason: "Goods not as described",
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Category string is required");
        });

        it("returns 403 if the caller is a stranger", async () => {
            (TradeService.prototype.initiateDispute as jest.Mock).mockRejectedValue(
                new Error("Access denied")
            );

            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .set("Authorization", `Bearer ${strangerToken}`)
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Forbidden");
        });

        it("returns 400 if trade status is invalid for dispute", async () => {
            (TradeService.prototype.initiateDispute as jest.Mock).mockRejectedValue(
                new Error("Trade must be FUNDED or DELIVERED to initiate dispute")
            );

            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Trade must be FUNDED or DELIVERED to initiate dispute");
        });

        it("returns 404 if trade not found", async () => {
            (TradeService.prototype.initiateDispute as jest.Mock).mockRejectedValue(
                new Error("Trade not found")
            );

            const res = await request(app)
                .post("/trades/9999999999/initiate-dispute")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("returns 401 without auth", async () => {
            const res = await request(app)
                .post("/trades/4294967297/initiate-dispute")
                .send({
                    reason: "Goods not as described",
                    category: "quality",
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("listTrades()", () => {
        it("returns paginated trades for the authenticated user", async () => {
            (TradeService.prototype.listTrades as jest.Mock).mockResolvedValue({
                trades: [
                    {
                        tradeId: "4294967297",
                        buyerAddress: buyerAddress,
                        sellerAddress: sellerAddress,
                        amountUsdc: "125.1234567",
                        status: "CREATED",
                    },
                ],
                total: 1,
                page: 1,
                limit: 10,
            });

            const res = await request(app)
                .get("/trades")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.trades).toHaveLength(1);
            expect(res.body.total).toBe(1);
            expect(res.body.page).toBe(1);
            expect(res.body.limit).toBe(10);
            expect(TradeService.prototype.listTrades).toHaveBeenCalledWith(
                buyerAddress,
                expect.objectContaining({
                    page: 1,
                    limit: 10,
                })
            );
        });

        it("handles pagination parameters correctly", async () => {
            (TradeService.prototype.listTrades as jest.Mock).mockResolvedValue({
                trades: [],
                total: 0,
                page: 2,
                limit: 5,
            });

            const res = await request(app)
                .get("/trades?page=2&limit=5")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.page).toBe(2);
            expect(res.body.limit).toBe(5);
            expect(TradeService.prototype.listTrades).toHaveBeenCalledWith(
                buyerAddress,
                expect.objectContaining({
                    page: 2,
                    limit: 5,
                })
            );
        });

        it("applies default pagination values", async () => {
            (TradeService.prototype.listTrades as jest.Mock).mockResolvedValue({
                trades: [],
                total: 0,
                page: 1,
                limit: 10,
            });

            const res = await request(app)
                .get("/trades")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.page).toBe(1);
            expect(res.body.limit).toBe(10);
        });

        it("filters by status", async () => {
            (TradeService.prototype.listTrades as jest.Mock).mockResolvedValue({
                trades: [
                    {
                        tradeId: "4294967297",
                        buyerAddress: buyerAddress,
                        sellerAddress: sellerAddress,
                        amountUsdc: "125.1234567",
                        status: "FUNDED",
                    },
                ],
                total: 1,
                page: 1,
                limit: 10,
            });

            const res = await request(app)
                .get("/trades?status=FUNDED")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(TradeService.prototype.listTrades).toHaveBeenCalledWith(
                buyerAddress,
                expect.objectContaining({
                    status: "FUNDED",
                })
            );
        });

        it("enforces access control (only user's trades)", async () => {
            (TradeService.prototype.listTrades as jest.Mock).mockResolvedValue({
                trades: [],
                total: 0,
                page: 1,
                limit: 10,
            });

            const res = await request(app)
                .get("/trades")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(200);
            expect(TradeService.prototype.listTrades).toHaveBeenCalledWith(
                strangerAddress,
                expect.any(Object)
            );
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).get("/trades");

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Unauthorized");
        });
    });

    describe("getTrade()", () => {
        it("returns trade details for the buyer", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
                createdAt: new Date().toISOString(),
            });

            const res = await request(app)
                .get("/trades/4294967297")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.tradeId).toBe("4294967297");
            expect(res.body.buyerAddress).toBe(buyerAddress);
            expect(res.body.sellerAddress).toBe(sellerAddress);
            expect(res.body.amountUsdc).toBe("125.1234567");
            expect(res.body.status).toBe("CREATED");
            expect(TradeService.prototype.getTradeById).toHaveBeenCalledWith(
                "4294967297",
                buyerAddress
            );
        });

        it("returns trade details for the seller", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
                createdAt: new Date().toISOString(),
            });

            const res = await request(app)
                .get("/trades/4294967297")
                .set("Authorization", `Bearer ${sellerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.tradeId).toBe("4294967297");
            expect(TradeService.prototype.getTradeById).toHaveBeenCalledWith(
                "4294967297",
                sellerAddress
            );
        });

        it("returns 403 if the caller is a stranger", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockRejectedValue(
                new Error("Access denied")
            );

            const res = await request(app)
                .get("/trades/4294967297")
                .set("Authorization", `Bearer ${strangerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("Forbidden");
        });

        it("returns 404 if trade not found", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .get("/trades/9999999999")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toBe("Trade not found");
        });

        it("returns all required fields", async () => {
            (TradeService.prototype.getTradeById as jest.Mock).mockResolvedValue({
                tradeId: "4294967297",
                buyerAddress: buyerAddress,
                sellerAddress: sellerAddress,
                amountUsdc: "125.1234567",
                status: "CREATED",
                createdAt: new Date().toISOString(),
                buyerLossBps: 5000,
                sellerLossBps: 5000,
            });

            const res = await request(app)
                .get("/trades/4294967297")
                .set("Authorization", `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty("tradeId");
            expect(res.body).toHaveProperty("buyerAddress");
            expect(res.body).toHaveProperty("sellerAddress");
            expect(res.body).toHaveProperty("amountUsdc");
            expect(res.body).toHaveProperty("status");
            expect(res.body).toHaveProperty("createdAt");
            expect(res.body).toHaveProperty("buyerLossBps");
            expect(res.body).toHaveProperty("sellerLossBps");
        });

        it("returns 401 without auth", async () => {
            const res = await request(app).get("/trades/4294967297");

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
            expect(res.body.error).toBe("Invalid sellerAddress");
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
            expect(res.body.error).toBe("Invalid amountUsdc");
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
        it("enforces auth on all endpoints", async () => {
            const endpoints = [
                { method: "post", path: "/trades" },
                { method: "post", path: "/trades/4294967297/deposit" },
                { method: "post", path: "/trades/4294967297/confirm-delivery" },
                { method: "post", path: "/trades/4294967297/release-funds" },
                { method: "post", path: "/trades/4294967297/initiate-dispute" },
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
});
