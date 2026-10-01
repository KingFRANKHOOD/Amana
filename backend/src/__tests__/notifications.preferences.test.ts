/**
 * Tests for the notification preferences fix.
 *
 * Before the fix:
 *   - preferencesSchema used z.record(z.string().min(1), …) — unlimited
 *     arbitrary string keys, enabling storage abuse.
 *   - normalizePreferences() silently returned {} on any validation error,
 *     so a bad PUT body appeared to succeed but preferences were lost.
 *
 * After the fix:
 *   - Keys are restricted to KNOWN_NOTIFICATION_EVENT_TYPES.
 *   - Maximum key count capped at the size of the allowed set.
 *   - validateRequest middleware (via preferencesSchema) rejects invalid
 *     bodies with HTTP 400 before the handler runs.
 *   - GET still returns an empty {} for users with no stored preferences.
 */

import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  createNotificationPreferencesRouter,
  KNOWN_NOTIFICATION_EVENT_TYPES,
} from "../routes/notifications.preferences.routes";
import { errorHandler } from "../middleware/errorHandler";

// ── Auth mock ────────────────────────────────────────────────────────────────

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";

function makeToken(walletAddress: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti: `pref-jti-${Date.now()}`,
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      nbf: now - 1,
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

function buildApp(mockPrisma: any) {
  const app = express();
  app.use(express.json());
  app.use("/", createNotificationPreferencesRouter(mockPrisma));
  app.use(errorHandler);
  return app;
}

function buildPrisma(storedPrefs: Record<string, any> | null = null) {
  return {
    notificationPreference: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          storedPrefs !== null ? { preferences: storedPrefs } : null,
        ),
      upsert: jest.fn().mockImplementation(async ({ create, update }: any) => ({
        preferences: update.preferences ?? create.preferences,
      })),
    },
  };
}

const validAddress = StellarSdk.Keypair.random().publicKey();
const validToken = makeToken(validAddress);

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Notification Preferences – key restriction fix", () => {
  describe("KNOWN_NOTIFICATION_EVENT_TYPES export", () => {
    it("contains the expected event types", () => {
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).toContain("TradeCreated");
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).toContain("DisputeInitiated");
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).toContain("FundsReleased");
      expect(KNOWN_NOTIFICATION_EVENT_TYPES.length).toBeGreaterThan(0);
    });

    it("does not contain arbitrary strings", () => {
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).not.toContain("anything");
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).not.toContain("malicious_key");
      expect(KNOWN_NOTIFICATION_EVENT_TYPES).not.toContain("__proto__");
    });
  });

  describe("GET /notifications/preferences", () => {
    it("returns 200 with empty preferences when none stored", async () => {
      const app = buildApp(buildPrisma(null));
      const res = await request(app)
        .get("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual({});
    });

    it("returns 200 with stored preferences for known event types", async () => {
      const stored = {
        TradeCreated: ["email"],
        DisputeInitiated: ["push", "in-app"],
      };
      const app = buildApp(buildPrisma(stored));
      const res = await request(app)
        .get("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual(stored);
    });

    it("returns 401 without an auth token", async () => {
      const app = buildApp(buildPrisma(null));
      const res = await request(app).get("/notifications/preferences");
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /notifications/preferences – valid bodies", () => {
    it("accepts a body with known event-type keys", async () => {
      const app = buildApp(buildPrisma(null));
      const body = { TradeCreated: ["email"], FundsReleased: ["push"] };

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toMatchObject(body);
    });

    it("merges incoming prefs on top of existing ones", async () => {
      const existing = { TradeCreated: ["email"] };
      const app = buildApp(buildPrisma(existing));
      const incoming = { FundsReleased: ["push"] };

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(incoming);

      expect(res.status).toBe(200);
      // Both keys should be present in the merged result
      expect(res.body.preferences).toMatchObject({
        TradeCreated: expect.any(Array),
        FundsReleased: expect.any(Array),
      });
    });

    it("accepts an empty object (clears all channels for no events)", async () => {
      const app = buildApp(buildPrisma(null));
      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send({});

      expect(res.status).toBe(200);
    });

    it("accepts all three channel types", async () => {
      const app = buildApp(buildPrisma(null));
      const body = { TradeCreated: ["email", "push", "in-app"] };

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.preferences.TradeCreated).toEqual(
        expect.arrayContaining(["email", "push", "in-app"]),
      );
    });
  });

  describe("PUT /notifications/preferences – invalid bodies (must return 400)", () => {
    it("rejects arbitrary unknown event-type keys", async () => {
      const app = buildApp(buildPrisma(null));
      const body = { malicious_key: ["email"] };

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      expect(res.status).toBe(400);
    });

    it("rejects a body with an oversized key count", async () => {
      const app = buildApp(buildPrisma(null));
      // Construct a body with more keys than KNOWN_NOTIFICATION_EVENT_TYPES.length
      const oversized: Record<string, string[]> = {};
      // Mix known + unknown keys to exceed the cap
      const allKnown = [...KNOWN_NOTIFICATION_EVENT_TYPES];
      for (const k of allKnown) {
        oversized[k] = ["email"];
      }
      // Add one extra unknown key to push over the limit
      (oversized as any)["extra_unknown_key"] = ["push"];

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(oversized);

      expect(res.status).toBe(400);
    });

    it("rejects an unknown channel type", async () => {
      const app = buildApp(buildPrisma(null));
      const body = { TradeCreated: ["sms"] }; // 'sms' is not a valid channel

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      expect(res.status).toBe(400);
    });

    it("rejects a non-object body (array)", async () => {
      const app = buildApp(buildPrisma(null));

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send([{ TradeCreated: ["email"] }]);

      expect(res.status).toBe(400);
    });

    it("rejects a non-object body (string)", async () => {
      const app = buildApp(buildPrisma(null));

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .set("Content-Type", "application/json")
        .send(JSON.stringify("bad-body"));

      expect(res.status).toBe(400);
    });

    it("rejects __proto__ pollution attempt via an unknown event-type key", async () => {
      const app = buildApp(buildPrisma(null));
      // Use a non-standard key that looks like a prototype attack but isn't
      // filtered by JSON.parse — use a key that isn't in the known set
      const body = { constructor: ["email"], prototype: ["push"] };

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      // Both "constructor" and "prototype" are not known event types → 400
      expect(res.status).toBe(400);
    });

    it("rejects a channel array that exceeds max length (>3)", async () => {
      const app = buildApp(buildPrisma(null));
      const body = { TradeCreated: ["email", "push", "in-app", "email"] }; // 4 entries

      const res = await request(app)
        .put("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`)
        .send(body);

      expect(res.status).toBe(400);
    });

    it("returns 401 without an auth token", async () => {
      const app = buildApp(buildPrisma(null));
      const res = await request(app)
        .put("/notifications/preferences")
        .send({ TradeCreated: ["email"] });

      expect(res.status).toBe(401);
    });
  });

  describe("Stored preferences normalization (GET)", () => {
    it("silently drops unknown keys from stored data (backward compat on read)", async () => {
      // Simulate legacy DB row with an unknown key from an older schema version
      const legacyStored = {
        TradeCreated: ["email"],
        legacy_unknown_event: ["push"], // was stored by old code
      };
      const app = buildApp(buildPrisma(legacyStored));

      const res = await request(app)
        .get("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      // Known key is preserved; unknown key is silently dropped
      expect(res.body.preferences).toHaveProperty("TradeCreated");
      expect(res.body.preferences).not.toHaveProperty("legacy_unknown_event");
    });

    it("returns empty preferences when stored value is null", async () => {
      const app = buildApp(buildPrisma(null));
      const res = await request(app)
        .get("/notifications/preferences")
        .set("Authorization", `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual({});
    });
  });
});
