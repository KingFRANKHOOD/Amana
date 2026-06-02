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
import * as UserService from "../services/user.service";
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
jest.mock("../services/user.service");

// Use a real valid Stellar public key so authMiddleware format checks pass
const mockWallet = Keypair.random().publicKey();

describe("User Routes & Controller", () => {
  let app: any;
  const mockUser = {
    address: mockWallet.toLowerCase(),
    display_name: "Test User",
    avatar_url: "https://example.com/avatar.png",
  };

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /users/me", () => {
    it("should return 200 and user profile when authenticated", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        walletAddress: mockWallet.toLowerCase(),
        sub: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);
      (UserService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const response = await request(app)
        .get("/users/me")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUser);
      expect(UserService.findOrCreateUser).toHaveBeenCalledWith(mockWallet.toLowerCase());
    });

    it("should return 401 when unauthenticated", async () => {
      const response = await request(app).get("/users/me");
      expect(response.status).toBe(401);
    });

    it("should return 401 when token is invalid", async () => {
      (AuthService.validateToken as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.AUTH_ERROR, "Invalid token", 401)
      );

      const response = await request(app)
        .get("/users/me")
        .set("Authorization", "Bearer invalid.jwt.token");

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /users/me", () => {
    it("should return 200 and updated profile", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);
      const updateData = { displayName: "New Name" };
      (UserService.updateUser as jest.Mock).mockResolvedValue({
        ...mockUser,
        display_name: "New Name",
      });

      const response = await request(app)
        .put("/users/me")
        .set("Authorization", "Bearer valid.jwt.token")
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.display_name).toBe("New Name");
      expect(UserService.updateUser).toHaveBeenCalledWith(
        mockWallet.toLowerCase(),
        updateData
      );
    });

    it("should return 400 for invalid input", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);
      (UserService.updateUser as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.VALIDATION_ERROR, "Invalid input", 400)
      );

      const response = await request(app)
        .put("/users/me")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({ displayName: "a" }); // Too short

      expect(response.status).toBe(400);
    });
  });

  describe("GET /users/:address", () => {
    it("should return 200 and public profile", async () => {
      (UserService.getPublicProfile as jest.Mock).mockResolvedValue({
        address: mockWallet.toLowerCase(),
        display_name: "Public User",
      });

      const response = await request(app).get(`/users/${mockWallet}`);

      expect(response.status).toBe(200);
      expect(response.body.display_name).toBe("Public User");
    });

    it("should return 404 if user not found", async () => {
      (UserService.getPublicProfile as jest.Mock).mockResolvedValue(null);

      const response = await request(app).get(`/users/${mockWallet}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe(ErrorCode.NOT_FOUND);
    });

    it("should return 400 for invalid wallet address", async () => {
      (UserService.getPublicProfile as jest.Mock).mockRejectedValue(
        new AppError(ErrorCode.VALIDATION_ERROR, "Invalid address", 400)
      );

      const response = await request(app).get("/users/invalid-address");
      expect(response.status).toBe(400);
    });
  });
});
