import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { walletRoutes } from "../routes/wallet.routes";
import { WalletService } from "../services/wallet.service";
import { PathPaymentService } from "../services/pathPayment.service";
import { AuthService } from "../services/auth.service";

// Mock the services
jest.mock("../services/wallet.service");
jest.mock("../services/pathPayment.service");

const app = express();
app.use(express.json());
app.use("/wallet", walletRoutes);

describe("Wallet Routes", () => {
  const mockWalletAddress = "GBBD47IF6LWK7P7MDEVSCWTTCJM4TWCH6TZZRVDI0Z00USDC";
  let token: string;

  beforeAll(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    // Generate a valid mock token for testing
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    token = jwt.sign(
      {
        walletAddress: mockWalletAddress,
        jti: "wallet-test-jti",
        nbf: Math.floor(Date.now() / 1000) - 5,
      },
      secret,
      {
        issuer: process.env.JWT_ISSUER || "amana",
        audience: process.env.JWT_AUDIENCE || "amana-api",
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /wallet/balance", () => {
    it("should return USDC amount for valid address with auth", async () => {
      const mockBalance = "150.50";
      (WalletService.prototype.getUsdcBalance as jest.Mock).mockResolvedValue(mockBalance);

      const res = await request(app)
        .get("/wallet/balance")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(mockBalance);
      expect(typeof res.body.asset).toBe("string");
      expect(res.body.asset.length).toBeGreaterThan(0);
      expect(WalletService.prototype.getUsdcBalance).toHaveBeenCalledWith(mockWalletAddress);
    });

    it("should return 401 without token", async () => {
      const res = await request(app).get("/wallet/balance");

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });
    
    it("should return 401 for invalid token format", async () => {
      const res = await request(app)
        .get("/wallet/balance")
        .set("Authorization", "InvalidTokenFormat");

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });
  });

  describe("GET /wallet/path-payment-quote", () => {
    it("should return routes array when authenticated", async () => {
      const mockQuotes = [
        {
          source_amount: "1000",
          source_asset_type: "native",
          source_asset_code: "NGN",
          destination_amount: "1",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          path: [],
        },
      ];

      (PathPaymentService.prototype.getPathPaymentQuote as jest.Mock).mockResolvedValue(mockQuotes);

      const res = await request(app)
        .get("/wallet/path-payment-quote")
        .set("Authorization", `Bearer ${token}`)
        .query({
          sourceAmount: "1000",
          sourceAsset: "NGN",
        });

      expect(res.status).toBe(200);
      expect(res.body.routes).toEqual(mockQuotes);
      expect(PathPaymentService.prototype.getPathPaymentQuote).toHaveBeenCalledWith(
        "1000",
        "NGN",
        undefined
      );
    });

    it("should return 400 without required query parameters", async () => {
      const res = await request(app)
        .get("/wallet/path-payment-quote")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing sourceAmount or sourceAsset");
    });

    it("should return 401 without token", async () => {
      const res = await request(app)
        .get("/wallet/path-payment-quote")
        .query({
          sourceAmount: "1000",
          sourceAsset: "NGN",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });
  });

  describe("failure matrix — provider errors translate to HTTP errors", () => {
    it("GET /wallet/balance returns 500 when WalletService throws a provider failure", async () => {
      (WalletService.prototype.getUsdcBalance as jest.Mock).mockRejectedValue(
        new Error("Stellar network unavailable")
      );

      const res = await request(app)
        .get("/wallet/balance")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error", "Failed to fetch balance");
    });

    it("GET /wallet/balance returns 400 when walletAddress is absent from the JWT payload", async () => {
      const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
      const tokenWithoutAddress = jwt.sign(
        { jti: "no-wallet-jti", nbf: Math.floor(Date.now() / 1000) - 5 },
        secret,
        {
          issuer: process.env.JWT_ISSUER || "amana",
          audience: process.env.JWT_AUDIENCE || "amana-api",
        }
      );

      const res = await request(app)
        .get("/wallet/balance")
        .set("Authorization", `Bearer ${tokenWithoutAddress}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Wallet address not found in token");
    });

    it("GET /wallet/path-payment-quote returns 500 when PathPaymentService throws", async () => {
      (PathPaymentService.prototype.getPathPaymentQuote as jest.Mock).mockRejectedValue(
        new Error("Horizon node unreachable")
      );

      const res = await request(app)
        .get("/wallet/path-payment-quote")
        .set("Authorization", `Bearer ${token}`)
        .query({ sourceAmount: "500", sourceAsset: "XLM" });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error", "Failed to fetch quotes");
    });

    it("GET /wallet/path-payment-quote forwards sourceAssetIssuer to PathPaymentService", async () => {
      (PathPaymentService.prototype.getPathPaymentQuote as jest.Mock).mockResolvedValue([]);

      const res = await request(app)
        .get("/wallet/path-payment-quote")
        .set("Authorization", `Bearer ${token}`)
        .query({
          sourceAmount: "100",
          sourceAsset: "USDC",
          sourceAssetIssuer: "GABCDE",
        });

      expect(res.status).toBe(200);
      expect(PathPaymentService.prototype.getPathPaymentQuote).toHaveBeenCalledWith(
        "100",
        "USDC",
        "GABCDE"
      );
    });
  });
});
