/**
 * Tests for CSRF protection middleware.
 *
 * Verifies that state-changing endpoints reject cross-origin requests when
 * the CSRF_PROTECTION feature flag is active, and pass valid same-origin
 * requests through.
 *
 * See: https://github.com/KingFRANKHOOD/Amana/issues/1024
 */
import request from "supertest";
import express, { Request, Response } from "express";
import {
  csrfProtection,
  validateCsrfOrigin,
  CSRF_FEATURE_FLAG,
} from "../middleware/csrf.middleware";
import { featureFlagService } from "../services/feature-flags.service";

// ---------------------------------------------------------------------------
// Unit tests for the pure validation function
// ---------------------------------------------------------------------------

describe("validateCsrfOrigin (unit)", () => {
  const allowed = ["https://app.amana.com", "https://staging.amana.com"];

  // Safe methods are always allowed, regardless of origin.
  describe("safe methods", () => {
    it.each(["GET", "HEAD", "OPTIONS"])(
      "allows %s regardless of origin",
      (method) => {
        expect(
          validateCsrfOrigin(method, "https://evil.com", undefined, allowed)
        ).toBeNull();
      }
    );
  });

  // State-changing methods.
  describe("state-changing methods", () => {
    it.each(["POST", "PUT", "PATCH", "DELETE"])(
      "allows %s from a permitted origin",
      (method) => {
        expect(
          validateCsrfOrigin(method, "https://app.amana.com", undefined, allowed)
        ).toBeNull();
      }
    );

    it.each(["POST", "PUT", "PATCH", "DELETE"])(
      "rejects %s from a cross-site origin",
      (method) => {
        const result = validateCsrfOrigin(
          method,
          "https://evil.com",
          undefined,
          allowed
        );
        expect(result).not.toBeNull();
        expect(result).toMatch(/evil\.com/);
      }
    );

    it("rejects when origin is not in the allow-list", () => {
      const result = validateCsrfOrigin(
        "POST",
        "https://not-allowed.com",
        undefined,
        allowed
      );
      expect(result).not.toBeNull();
    });

    it("allows when no origin/referer present and allowMissingOrigin=true (default)", () => {
      expect(
        validateCsrfOrigin("POST", undefined, undefined, allowed, true)
      ).toBeNull();
    });

    it("rejects when no origin/referer and allowMissingOrigin=false", () => {
      const result = validateCsrfOrigin(
        "POST",
        undefined,
        undefined,
        allowed,
        false
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/missing Origin/i);
    });
  });

  // Referer fallback.
  describe("Referer fallback (no Origin header)", () => {
    it("allows when Referer host matches an allowed origin", () => {
      expect(
        validateCsrfOrigin(
          "POST",
          undefined,
          "https://app.amana.com/trades/new",
          allowed
        )
      ).toBeNull();
    });

    it("rejects when Referer host is cross-site", () => {
      const result = validateCsrfOrigin(
        "POST",
        undefined,
        "https://evil.com/csrf-attack",
        allowed
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/referer origin/i);
    });

    it("rejects when Referer value is malformed", () => {
      const result = validateCsrfOrigin(
        "POST",
        undefined,
        "not-a-url",
        allowed
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/malformed/i);
    });
  });

  // Empty allow-list (development mode).
  describe("empty allow-list (permissive / development)", () => {
    it("allows any origin when CORS_ORIGINS is not configured", () => {
      expect(
        validateCsrfOrigin("POST", "https://evil.com", undefined, [])
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests via a minimal Express app
// ---------------------------------------------------------------------------

/**
 * Build a tiny Express app with CSRF middleware and a state-changing route
 * for integration tests.
 */
function buildTestApp(allowMissingOrigin = true) {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection({ allowMissingOrigin }));

  app.post("/trades", (_req: Request, res: Response) => {
    res.status(201).json({ ok: true });
  });
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

describe("csrfProtection middleware (integration)", () => {
  const ALLOWED = "https://app.amana.com";
  const EVIL = "https://evil.com";

  // Control the feature flag mock.
  let mockIsEnabled: jest.SpyInstance;

  beforeEach(() => {
    mockIsEnabled = jest
      .spyOn(featureFlagService, "isEnabled")
      .mockImplementation(async (name: string) => name === CSRF_FEATURE_FLAG);

    // Point CORS_ORIGINS at the test allowed origin.
    process.env.CORS_ORIGINS = ALLOWED;
  });

  afterEach(() => {
    mockIsEnabled.mockRestore();
    delete process.env.CORS_ORIGINS;
  });

  it("passes GET requests through regardless of origin", async () => {
    const app = buildTestApp();
    await request(app)
      .get("/health")
      .set("Origin", EVIL)
      .expect(200);
  });

  it("allows POST from a permitted same-origin request", async () => {
    const app = buildTestApp();
    await request(app)
      .post("/trades")
      .set("Origin", ALLOWED)
      .expect(201);
  });

  it("rejects POST from a cross-site origin with 403", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/trades")
      .set("Origin", EVIL)
      .expect(403);

    expect(res.body.code).toBe("CSRF_VIOLATION");
  });

  it("rejects POST with cross-site Referer when Origin is absent", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/trades")
      .set("Referer", `${EVIL}/attack-page`)
      .expect(403);

    expect(res.body.code).toBe("CSRF_VIOLATION");
  });

  it("allows POST with valid Referer when Origin is absent", async () => {
    const app = buildTestApp();
    await request(app)
      .post("/trades")
      .set("Referer", `${ALLOWED}/trades/new`)
      .expect(201);
  });

  it("always protects cookie-authenticated mutations when the feature flag is disabled", async () => {
    mockIsEnabled.mockResolvedValue(false);
    const app = buildTestApp();

    await request(app)
      .post("/trades")
      .set("Cookie", "amana_access=jwt")
      .set("Origin", EVIL)
      .expect(403);

    await request(app)
      .post("/trades")
      .set("Cookie", "amana_access=jwt")
      .set("Origin", ALLOWED)
      .expect(201);
  });

  it("allows POST with no origin headers when allowMissingOrigin=true", async () => {
    const app = buildTestApp(true);
    await request(app).post("/trades").expect(201);
  });

  it("rejects POST with no origin headers when allowMissingOrigin=false", async () => {
    const app = buildTestApp(false);
    const res = await request(app).post("/trades").expect(403);
    expect(res.body.code).toBe("CSRF_VIOLATION");
  });

  it("is transparent pass-through when CSRF_PROTECTION flag is disabled", async () => {
    // Override: flag is OFF
    mockIsEnabled.mockImplementation(async () => false);
    const app = buildTestApp();

    // Even a cross-site origin must be allowed when the flag is off.
    await request(app)
      .post("/trades")
      .set("Origin", EVIL)
      .expect(201);
  });
});
