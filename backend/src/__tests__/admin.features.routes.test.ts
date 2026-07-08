import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createAdminFeaturesRouter } from "../routes/admin.features.routes";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => {
  const actual = jest.requireActual("../services/auth.service");
  return {
    ...actual,
    AuthService: {
      validateToken: jest.fn(async (token: string) => {
        const jsonwebtoken = require("jsonwebtoken");
        return jsonwebtoken.decode(token);
      }),
      isTokenRevoked: jest.fn().mockResolvedValue(false),
    },
  };
});

jest.mock("../services/feature-flags.service", () => ({
  featureFlagService: {
    listFlags: jest.fn(),
    setFlag: jest.fn(),
  },
}));

import { AuthService } from "../services/auth.service";
import { featureFlagService } from "../services/feature-flags.service";

const mockFeatureFlagService = featureFlagService as unknown as {
  listFlags: jest.Mock;
  setFlag: jest.Mock;
};

const app = express();
app.use(express.json());
app.use("/", createAdminFeaturesRouter());
app.use(errorHandler);

describe("Admin Features Routes", () => {
  const adminAddress = StellarSdk.Keypair.random().publicKey();
  const nonAdminAddress = StellarSdk.Keypair.random().publicKey();
  let adminToken: string;
  let nonAdminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    adminToken = jwt.sign(
      {
        walletAddress: adminAddress,
        jti: "features-admin-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    nonAdminToken = jwt.sign(
      {
        walletAddress: nonAdminAddress,
        jti: "features-nonadmin-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  describe("GET /admin/features", () => {
    it("returns the flag map for an admin", async () => {
      mockFeatureFlagService.listFlags.mockResolvedValue({
        "new-checkout": { enabled: true, updatedAt: "t" },
      });

      const res = await request(app)
        .get("/admin/features")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.flags).toEqual({
        "new-checkout": { enabled: true, updatedAt: "t" },
      });
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get("/admin/features");
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-admin users", async () => {
      const res = await request(app)
        .get("/admin/features")
        .set("Authorization", `Bearer ${nonAdminToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /admin/features/:name", () => {
    it("updates a flag as an admin", async () => {
      mockFeatureFlagService.setFlag.mockResolvedValue({
        enabled: true,
        rolloutPercentage: 25,
        updatedAt: "t",
      });

      const res = await request(app)
        .patch("/admin/features/new-checkout")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true, rolloutPercentage: 25 });

      expect(res.status).toBe(200);
      expect(mockFeatureFlagService.setFlag).toHaveBeenCalledWith("new-checkout", {
        enabled: true,
        rolloutPercentage: 25,
      });
      expect(res.body).toEqual({
        name: "new-checkout",
        flag: { enabled: true, rolloutPercentage: 25, updatedAt: "t" },
      });
    });

    it("rejects a rolloutPercentage outside 0-100", async () => {
      const res = await request(app)
        .patch("/admin/features/new-checkout")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true, rolloutPercentage: 150 });

      expect(res.status).toBe(400);
      expect(mockFeatureFlagService.setFlag).not.toHaveBeenCalled();
    });

    it("returns 403 for non-admin users", async () => {
      const res = await request(app)
        .patch("/admin/features/new-checkout")
        .set("Authorization", `Bearer ${nonAdminToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(403);
    });
  });
});
