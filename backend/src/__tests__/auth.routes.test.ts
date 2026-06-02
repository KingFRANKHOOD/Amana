process.env.JWT_SECRET = "a".repeat(32);
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgres://dummy";
process.env.AMANA_ESCROW_CONTRACT_ID = "C123";
process.env.USDC_CONTRACT_ID = "C456";

import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { createApp } from "../app";
import { AuthService } from "../services/auth.service";
import { AppError, ErrorCode } from "../errors/errorCodes";

// auth.service.ts creates its own ioredis instance — mock at the ioredis level
jest.mock("ioredis", () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
  }))
);

jest.mock("../services/auth.service");

describe("Auth Routes", () => {
  let app: any;
  // Use a real valid Stellar public key so Zod/StrKey validation in the route passes
  const mockWallet = Keypair.random().publicKey();

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /auth/challenge", () => {
    it("should return 200 and challenge string", async () => {
      (AuthService.generateChallenge as jest.Mock).mockResolvedValue("mock-challenge");

      const response = await request(app)
        .post("/auth/challenge")
        .send({ walletAddress: mockWallet });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ challenge: "mock-challenge" });
      expect(AuthService.generateChallenge).toHaveBeenCalledWith(mockWallet);
    });

    it("should return 400 for invalid wallet address", async () => {
      const response = await request(app)
        .post("/auth/challenge")
        .send({ walletAddress: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe("POST /auth/verify", () => {
    it("should return 200 and token on success", async () => {
      (AuthService.verifySignatureAndIssueJWT as jest.Mock).mockResolvedValue("mock-jwt");

      const response = await request(app)
        .post("/auth/verify")
        .send({
          walletAddress: mockWallet,
          signedChallenge: "mock-signature",
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ token: "mock-jwt" });
    });

    it("should return 401 for invalid signature or expired challenge", async () => {
      (AuthService.verifySignatureAndIssueJWT as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.AUTH_ERROR, "Invalid signature", 401)
      );

      const response = await request(app)
        .post("/auth/verify")
        .send({
          walletAddress: mockWallet,
          signedChallenge: "invalid-signature",
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid signature");
    });

    it("should return 400 for malformed payload (missing signedChallenge)", async () => {
      const response = await request(app)
        .post("/auth/verify")
        .send({ walletAddress: mockWallet }); // Missing signedChallenge

      expect(response.status).toBe(400);
    });
  });

  describe("POST /auth/refresh", () => {
    it("should return 200 and new token", async () => {
      (AuthService.refreshToken as jest.Mock).mockResolvedValue("new-jwt");

      const response = await request(app)
        .post("/auth/refresh")
        .set("Authorization", "Bearer old.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ token: "new-jwt" });
      expect(AuthService.refreshToken).toHaveBeenCalledWith("old.jwt.token");
    });

    it("should return 401 if token too old to refresh", async () => {
      (AuthService.refreshToken as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.AUTH_ERROR, "Token too old to refresh", 401)
      );

      const response = await request(app)
        .post("/auth/refresh")
        .set("Authorization", "Bearer very.old.jwt");

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Token too old to refresh");
    });

    it("should return 401 if authorization header is missing", async () => {
      const response = await request(app).post("/auth/refresh");
      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Missing or invalid authorization header");
    });
  });

  describe("POST /auth/logout", () => {
    it("should return 200 on success", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        jti: "mock-jti",
        exp: Math.floor(Date.now() / 1000) + 3600,
        walletAddress: mockWallet.toLowerCase(),
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post("/auth/logout")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(AuthService.revokeToken).toHaveBeenCalledWith(
        "mock-jti",
        expect.any(Number)
      );
    });

    it("should return 401 if unauthenticated", async () => {
      const response = await request(app).post("/auth/logout");
      expect(response.status).toBe(401);
    });
  });

  describe("GET /auth/validate", () => {
    it("should return 200 and user info if token is valid", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .get("/auth/validate")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.user.walletAddress).toBe(mockWallet.toLowerCase());
    });

    it("should return 401 if token is invalid", async () => {
      (AuthService.validateToken as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.AUTH_ERROR, "Token expired", 401)
      );

      const response = await request(app)
        .get("/auth/validate")
        .set("Authorization", "Bearer expired.jwt.token");

      expect(response.status).toBe(401);
    });
  });
});
