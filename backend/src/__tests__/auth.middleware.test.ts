import express, { Request, Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthService } from "../services/auth.service";

jest.mock("../services/auth.service");

const JWT_SECRET = "a-very-long-secret-that-is-at-least-32-chars-long";
const JWT_ISSUER = "amana";
const JWT_AUDIENCE = "amana-api";

const mockedIsTokenRevoked = AuthService.isTokenRevoked as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", authMiddleware, (req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

function makeToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: "gaddress",
    walletAddress: "gaddress",
    jti: "test-jti-123",
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + 86400,
  };
  return jwt.sign({ ...base, ...overrides }, JWT_SECRET, { algorithm: "HS256" });
}

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = JWT_ISSUER;
  process.env.JWT_AUDIENCE = JWT_AUDIENCE;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("authMiddleware — positive flow", () => {
  it("allows a fully valid token through", async () => {
    mockedIsTokenRevoked.mockResolvedValue(false);
    const app = buildApp();
    const token = makeToken();

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("authMiddleware — missing / malformed header", () => {
  it("rejects request with no Authorization header", async () => {
    const app = buildApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects request with non-Bearer scheme", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });

  it("rejects a completely invalid token string", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — wrong claims", () => {
  it("rejects token with wrong issuer", async () => {
    const app = buildApp();
    const token = makeToken({ iss: "evil-issuer" });
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects token with wrong audience", async () => {
    const app = buildApp();
    const token = makeToken({ aud: "wrong-audience" });
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects token missing jti claim", async () => {
    mockedIsTokenRevoked.mockResolvedValue(false);
    const app = buildApp();
    const now = Math.floor(Date.now() / 1000);
    // Build payload manually without jti
    const payload = {
      walletAddress: "gaddress",
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + 86400,
    };
    const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/jti/);
  });

  it("rejects token where nbf is in the future", async () => {
    mockedIsTokenRevoked.mockResolvedValue(false);
    const app = buildApp();
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({ nbf: now + 3600 }); // valid 1 hour from now

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not yet valid/);
  });

  it("rejects an expired token", async () => {
    const app = buildApp();
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({ iat: now - 200, nbf: now - 200, exp: now - 100 });

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe("authMiddleware — revocation", () => {
  it("rejects a revoked token", async () => {
    mockedIsTokenRevoked.mockResolvedValue(true);
    const app = buildApp();
    const token = makeToken();

    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/);
  });

  it("calls isTokenRevoked with the jti from the token", async () => {
    mockedIsTokenRevoked.mockResolvedValue(false);
    const app = buildApp();
    const token = makeToken({ jti: "specific-jti-abc" });

    await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(mockedIsTokenRevoked).toHaveBeenCalledWith("specific-jti-abc");
  });
});
