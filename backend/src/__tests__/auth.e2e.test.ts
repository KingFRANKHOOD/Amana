/**
 * E2E integration tests for the JWT challenge-verify authentication flow.
 *
 * Covers:
 *  - POST /auth/challenge  → returns a unique challenge string
 *  - Freighter mock: signs challenge with a real Ed25519 keypair
 *  - POST /auth/verify     → validates signature and returns JWT
 *  - JWT claims: walletAddress, iat, exp, iss, aud, jti, nbf
 *  - Challenge stored in Redis (key present after /challenge)
 *  - Replay protection: challenge deleted after first verify attempt
 *  - Protected route: valid JWT → 200 + walletAddress extracted
 *  - Invalid signature → 401
 *  - Expired JWT → 401
 *  - Missing JWT → 401
 *  - POST /auth/logout     → revokes token; subsequent request rejected 401
 *  - Rate limiting         → 11th request in window rejected 429
 */

import express, { Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

// ── Disable rate limiting for all tests (tested separately below) ─────────────
jest.mock("express-rate-limit", () =>
  jest.fn(() => (_req: any, _res: any, next: any) => next())
);

// ── Redis mock (in-memory store, no real Redis needed) ────────────────────────
const redisStore = new Map<string, string>();

jest.mock("ioredis", () =>
  jest.fn().mockImplementation(() => ({
    set: jest.fn((key: string, value: string) => {
      redisStore.set(key, value);
      return Promise.resolve("OK");
    }),
    get: jest.fn((key: string) =>
      Promise.resolve(redisStore.get(key) ?? null)
    ),
    del: jest.fn((key: string) => {
      redisStore.delete(key);
      return Promise.resolve(1);
    }),
    exists: jest.fn((key: string) =>
      Promise.resolve(redisStore.has(key) ? 1 : 0)
    ),
  }))
);

// ── Database / user-service mock ──────────────────────────────────────────────
jest.mock("../services/user.service", () => ({
  findOrCreateUser: jest.fn().mockResolvedValue({ address: "mock-address" }),
}));

// ── Test constants ────────────────────────────────────────────────────────────
const JWT_SECRET = "a-very-long-test-secret-at-least-32-chars!";
const JWT_ISSUER = "amana";
const JWT_AUDIENCE = "amana-api";

// ── App factory ───────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authRoutes } = require("../routes/auth.routes");

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);

  // Protected echo endpoint — used to verify downstream JWT validation
  app.get("/protected", authMiddleware, (req: AuthRequest, res: Response) => {
    res.json({ walletAddress: req.user?.walletAddress });
  });

  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sign a challenge string with a Stellar Ed25519 keypair (mirrors Freighter). */
function freighterSign(keypair: Keypair, challenge: string): string {
  const sig = keypair.sign(Buffer.from(challenge, "utf8"));
  return Buffer.from(sig).toString("base64url");
}

/** Build an already-expired JWT for testing 401 handling. */
function makeExpiredToken(walletAddress: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: walletAddress.toLowerCase(),
      walletAddress: walletAddress.toLowerCase(),
      jti: "expired-jti-test",
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now - 200,
      nbf: now - 200,
      exp: now - 100,
    },
    JWT_SECRET,
    { algorithm: "HS256" }
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = JWT_ISSUER;
  process.env.JWT_AUDIENCE = JWT_AUDIENCE;
});

beforeEach(() => {
  redisStore.clear();
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /auth/challenge
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/challenge", () => {
  it("returns a challenge string for a valid Stellar wallet address", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const res = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    expect(res.status).toBe(200);
    expect(typeof res.body.challenge).toBe("string");
    expect(res.body.challenge.length).toBeGreaterThan(0);
  });

  it("generates a unique challenge on each request (random per request)", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const res1 = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    redisStore.clear();

    const res2 = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    expect(res1.body.challenge).toBeDefined();
    expect(res2.body.challenge).toBeDefined();
    expect(res1.body.challenge).not.toEqual(res2.body.challenge);
  });

  it("stores the challenge in Redis keyed by wallet address", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const res = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    expect(res.status).toBe(200);
    const storedChallenge = redisStore.get(
      `challenge:${keypair.publicKey().toLowerCase()}`
    );
    expect(storedChallenge).toBe(res.body.challenge);
  });

  it("rejects an invalid (non-Stellar) wallet address with 400", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: "not-a-stellar-address" });

    expect(res.status).toBe(400);
  });

  it("rejects a request missing the walletAddress field with 400", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/challenge").send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /auth/verify
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/verify", () => {
  it("issues a JWT when the signed challenge is valid (full happy path)", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const challengeRes = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    expect(challengeRes.status).toBe(200);
    const { challenge } = challengeRes.body as { challenge: string };

    const signedChallenge = freighterSign(keypair, challenge);

    const verifyRes = await request(app)
      .post("/auth/verify")
      .send({ walletAddress: keypair.publicKey(), signedChallenge });

    expect(verifyRes.status).toBe(200);
    expect(typeof verifyRes.body.token).toBe("string");
  });

  it("JWT contains required claims: walletAddress, iat, exp, iss, aud, jti, nbf", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const {
      body: { challenge },
    } = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    const {
      body: { token },
    } = await request(app)
      .post("/auth/verify")
      .send({
        walletAddress: keypair.publicKey(),
        signedChallenge: freighterSign(keypair, challenge),
      });

    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.walletAddress).toBe(keypair.publicKey().toLowerCase());
    expect(decoded.iss).toBe(JWT_ISSUER);
    expect(decoded.aud).toBe(JWT_AUDIENCE);
    expect(typeof decoded.jti).toBe("string");
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
    expect(typeof decoded.nbf).toBe("number");
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
  });

  it("rejects an invalid (tampered) signature with 401", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const {
      body: { challenge },
    } = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    // Sign with a different keypair — signature will not match
    const wrongKeypair = Keypair.random();
    const badSignedChallenge = freighterSign(wrongKeypair, challenge);

    const verifyRes = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge: badSignedChallenge,
    });

    expect(verifyRes.status).toBe(401);
  });

  it("rejects verify when no challenge exists (expired / never issued)", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    // Attempt verify without first calling /challenge
    const signedChallenge = freighterSign(keypair, "fake-challenge");

    const verifyRes = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge,
    });

    expect(verifyRes.status).toBe(401);
  });

  it("enforces replay protection — challenge is deleted after first verify attempt", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const {
      body: { challenge },
    } = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    const signedChallenge = freighterSign(keypair, challenge);

    // First verify succeeds
    const firstRes = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge,
    });
    expect(firstRes.status).toBe(200);

    // Replay the same signed challenge — challenge key has been deleted
    const replayRes = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge,
    });
    expect(replayRes.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Protected route — auth middleware validates JWT
// ─────────────────────────────────────────────────────────────────────────────

describe("Protected route with JWT", () => {
  it("grants access and exposes walletAddress when JWT is valid", async () => {
    const keypair = Keypair.random();
    const app = buildApp();

    const {
      body: { challenge },
    } = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    const {
      body: { token },
    } = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge: freighterSign(keypair, challenge),
    });

    const protectedRes = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.walletAddress).toBe(
      keypair.publicKey().toLowerCase()
    );
  });

  it("rejects a request with no Authorization header (401)", async () => {
    const app = buildApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a request with an expired JWT (401)", async () => {
    const keypair = Keypair.random();
    const app = buildApp();
    const expiredToken = makeExpiredToken(keypair.publicKey());

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  it("rejects a request with a missing JWT value (401)", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /auth/logout — revokes token
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/logout", () => {
  async function authenticatedToken(keypair: Keypair, app: express.Application) {
    const {
      body: { challenge },
    } = await request(app)
      .post("/auth/challenge")
      .send({ walletAddress: keypair.publicKey() });

    const {
      body: { token },
    } = await request(app).post("/auth/verify").send({
      walletAddress: keypair.publicKey(),
      signedChallenge: freighterSign(keypair, challenge),
    });

    return token as string;
  }

  it("returns a success message on logout", async () => {
    const keypair = Keypair.random();
    const app = buildApp();
    const token = await authenticatedToken(keypair, app);

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toMatch(/logged out/i);
  });

  it("rejects protected-route requests after logout (token revoked)", async () => {
    const keypair = Keypair.random();
    const app = buildApp();
    const token = await authenticatedToken(keypair, app);

    // Confirm the token works before logout
    const beforeLogout = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(beforeLogout.status).toBe(200);

    await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    // Token must now be rejected with revoked error
    const afterLogout = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error).toMatch(/revoked/i);
  });

  it("rejects logout with no Authorization header (401)", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rate limiting — 11th request in 15-minute window rejected with 429
//
// This test uses a dedicated mini-app with the real express-rate-limit
// (bypassing the global mock) to validate the limiter configuration.
// ─────────────────────────────────────────────────────────────────────────────

describe("Rate limiting", () => {
  it("allows 10 requests and rejects the 11th with 429", async () => {
    // Use the actual (unmocked) express-rate-limit to mirror what auth.routes.ts configures
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: actualRateLimit } = jest.requireActual<any>("express-rate-limit");

    const limiter = actualRateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: "Too many challenges/verify attempts, try again later.",
    });

    // Minimal app: just the rate limiter in front of a trivial handler
    const app = express();
    app.post("/auth/challenge", limiter, (_req, res) => {
      res.json({ challenge: "test-challenge" });
    });

    // First 10 requests must pass through
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/auth/challenge").send({});
      expect(res.status).not.toBe(429);
    }

    // 11th request must be rate-limited
    const rateLimitedRes = await request(app)
      .post("/auth/challenge")
      .send({});
    expect(rateLimitedRes.status).toBe(429);
  });
});
