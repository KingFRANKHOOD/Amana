process.env.JWT_SECRET = "a".repeat(32);
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgres://dummy";
process.env.AMANA_ESCROW_CONTRACT_ID = "C123";
process.env.USDC_CONTRACT_ID = "C456";

import request from "supertest";
import express from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { authRoutes } from "../routes/auth.routes";
import { AuthService } from "../services/auth.service";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';
import { errorHandler } from "../middleware/errorHandler";

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
    app = express();
    app.use(express.json());
    app.use("/auth", authRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthService.issueSession as jest.Mock).mockResolvedValue({
      accessToken: "mock-jwt",
      refreshToken: "mock-refresh",
    });
    (AuthService.revokeRefreshToken as jest.Mock).mockResolvedValue(undefined);
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
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(response.body.message).toBeDefined();
    });
  });

  describe("POST /auth/verify", () => {
    it("sets HttpOnly secure session cookies without exposing tokens", async () => {
      (AuthService.verifySignatureAndIssueJWT as jest.Mock).mockResolvedValue("mock-jwt");

      const response = await request(app)
        .post("/auth/verify")
        .send({
          walletAddress: mockWallet,
          signedChallenge: "mock-signature",
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: true });
      expect(JSON.stringify(response.body)).not.toContain("mock-jwt");
      const cookies = response.headers["set-cookie"] as unknown as string[];
      expect(cookies).toEqual(expect.arrayContaining([
        expect.stringContaining("amana_access=mock-jwt"),
        expect.stringContaining("amana_refresh=mock-refresh"),
      ]));
      for (const cookie of cookies) {
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("Secure");
        expect(cookie).toContain("SameSite=Strict");
      }
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
      expect(response.body.code).toBe(ErrorCode.AUTH_ERROR);
      expect(response.body.message).toBe("Invalid signature");
    });

    it("should return 400 for malformed payload (missing signedChallenge)", async () => {
      const response = await request(app)
        .post("/auth/verify")
        .send({ walletAddress: mockWallet }); // Missing signedChallenge

      expect(response.status).toBe(400);
      expect(response.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("POST /auth/refresh", () => {
    it("rotates the HttpOnly refresh cookie", async () => {
      (AuthService.rotateRefreshToken as jest.Mock).mockResolvedValue({
        accessToken: "new-jwt",
        refreshToken: "new-refresh",
      });

      const response = await request(app)
        .post("/auth/refresh")
        .set("Origin", "https://app.amana.com")
        .set("Cookie", "amana_refresh=old-refresh");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: true });
      expect(AuthService.rotateRefreshToken).toHaveBeenCalledWith("old-refresh");
      expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([
        expect.stringContaining("amana_access=new-jwt"),
        expect.stringContaining("amana_refresh=new-refresh"),
      ]));
    });

    it("should return 401 if token too old to refresh", async () => {
      (AuthService.rotateRefreshToken as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.AUTH_ERROR, "Token too old to refresh", 401)
      );

      const response = await request(app)
        .post("/auth/refresh")
        .set("Origin", "https://app.amana.com")
        .set("Cookie", "amana_refresh=very-old-refresh");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.AUTH_ERROR);
      expect(response.body.message).toBe("Token too old to refresh");
    });

    it("should return 401 if authorization header is missing", async () => {
      const response = await request(app).post("/auth/refresh");
      expect(response.status).toBe(401);
      expect(response.body.code).toBe(ErrorCode.AUTH_ERROR);
      expect(response.body.message).toContain("Missing refresh token cookie");
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
      // Bounded public profile — must not expose jti, sub, iat, exp
      expect(response.body.user.jti).toBeUndefined();
      expect(response.body.user.sub).toBeUndefined();
      expect(response.body.user.iat).toBeUndefined();
      expect(response.body.user.exp).toBeUndefined();
      expect(Object.keys(response.body.user)).toEqual(["walletAddress"]);
    });

    it("should return bounded profile with only walletAddress (no jti leakage)", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "secret-jti-should-not-leak",
        iat: 123456,
        exp: 999999,
        iss: "amana",
        aud: "amana-api",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .get("/auth/validate")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({ walletAddress: mockWallet.toLowerCase() });
      expect(JSON.stringify(response.body)).not.toContain("secret-jti-should-not-leak");
      expect(JSON.stringify(response.body)).not.toContain("123456");
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
