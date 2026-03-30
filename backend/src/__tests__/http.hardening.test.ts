import request from "supertest";

/**
 * Tests for HTTP baseline hardening:
 *  - Security headers from Helmet
 *  - CORS allowlist enforcement
 *  - Oversized payload rejection
 *
 * The createApp() function reads CORS_ORIGINS from process.env at call time,
 * so we set the env var before each relevant describe block.
 */

afterEach(() => {
  delete process.env.CORS_ORIGINS;
  jest.resetModules();
});

async function buildApp(corsOrigins?: string) {
  if (corsOrigins !== undefined) {
    process.env.CORS_ORIGINS = corsOrigins;
  }
  // Re-import so CORS_ORIGINS is picked up fresh
  const { createApp } = await import("../app");
  return createApp();
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

describe("Helmet security headers", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const app = await buildApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const app = await buildApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets Strict-Transport-Security header", async () => {
    const app = await buildApp();
    const res = await request(app).get("/health");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });

  it("sets Content-Security-Policy header", async () => {
    const app = await buildApp();
    const res = await request(app).get("/health");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CORS — allowlist enforcement
// ---------------------------------------------------------------------------

describe("CORS allowlist", () => {
  it("allows a request from a whitelisted origin", async () => {
    const app = await buildApp("https://app.amana.com");
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://app.amana.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.amana.com");
  });

  it("blocks a request from a non-whitelisted origin", async () => {
    const app = await buildApp("https://app.amana.com");
    const res = await request(app)
      .options("/health")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "GET");
    // Either no ACAO header, or a 500 from the cors error callback
    const acao = res.headers["access-control-allow-origin"] ?? "";
    expect(acao).not.toBe("https://evil.example.com");
  });

  it("allows multiple whitelisted origins", async () => {
    const app = await buildApp("https://app.amana.com,https://staging.amana.com");

    const res1 = await request(app)
      .get("/health")
      .set("Origin", "https://app.amana.com");
    expect(res1.headers["access-control-allow-origin"]).toBe("https://app.amana.com");

    const res2 = await request(app)
      .get("/health")
      .set("Origin", "https://staging.amana.com");
    expect(res2.headers["access-control-allow-origin"]).toBe("https://staging.amana.com");
  });

  it("permits server-to-server calls with no Origin header", async () => {
    const app = await buildApp("https://app.amana.com");
    const res = await request(app).get("/health"); // no Origin
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Body size limits
// ---------------------------------------------------------------------------

describe("Request body size limits", () => {
  it("accepts a JSON payload under the 100 KB limit", async () => {
    const app = await buildApp();
    const body = { data: "x".repeat(1000) };
    const res = await request(app)
      .get("/health")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);
  });

  it("rejects a JSON payload exceeding the 100 KB limit", async () => {
    const app = await buildApp();
    // Build a payload > 100 KB
    const bigBody = JSON.stringify({ data: "x".repeat(110 * 1024) });
    const res = await request(app)
      .post("/auth/challenge")
      .set("Content-Type", "application/json")
      .send(bigBody);
    // Express returns 413 Payload Too Large
    expect(res.status).toBe(413);
  });
});
