import request from "supertest";
import express, { NextFunction, Request, Response } from "express";
import {
  correlationIdMiddleware,
  isValidId,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  TracedRequest,
} from "../middleware/correlationId.middleware";
import { createApp } from "../app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal app that echoes the tracing IDs from the request object. */
function makeEchoApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.get("/echo", (req: Request, res: Response) => {
    const traced = req as TracedRequest;
    res.json({
      correlationId: traced.correlationId,
      requestId: traced.requestId,
    });
  });
  return app;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// isValidId unit tests
// ---------------------------------------------------------------------------

describe("isValidId", () => {
  it("returns true for a standard UUID", () => {
    expect(isValidId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns true for alphanumeric strings", () => {
    expect(isValidId("abc123")).toBe(true);
  });

  it("returns true for strings with hyphens and underscores", () => {
    expect(isValidId("my_trace-id_001")).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isValidId(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidId("")).toBe(false);
  });

  it("returns false for strings longer than 128 characters", () => {
    expect(isValidId("a".repeat(129))).toBe(false);
  });

  it("returns true for exactly 128 characters", () => {
    expect(isValidId("a".repeat(128))).toBe(true);
  });

  it("returns false for strings with spaces", () => {
    expect(isValidId("bad id")).toBe(false);
  });

  it("returns false for strings with newlines (header injection)", () => {
    expect(isValidId("id\nX-Injected: evil")).toBe(false);
  });

  it("returns false for strings with carriage returns (header injection)", () => {
    expect(isValidId("id\rX-Injected: evil")).toBe(false);
  });

  it("returns false for strings with special characters", () => {
    expect(isValidId("id<script>")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// correlationIdMiddleware – response headers
// ---------------------------------------------------------------------------

describe("correlationIdMiddleware – response headers", () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeEchoApp();
  });

  it("sets x-correlation-id and x-request-id response headers", async () => {
    const res = await request(app).get("/echo");
    expect(res.headers[CORRELATION_ID_HEADER]).toBeDefined();
    expect(res.headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  it("generates a valid UUID for x-correlation-id when none is supplied", async () => {
    const res = await request(app).get("/echo");
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(UUID_RE);
  });

  it("generates a valid UUID for x-request-id", async () => {
    const res = await request(app).get("/echo");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_RE);
  });

  it("propagates a valid caller-supplied x-correlation-id", async () => {
    const callerCorrelationId = "550e8400-e29b-41d4-a716-446655440000";
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, callerCorrelationId);
    expect(res.headers[CORRELATION_ID_HEADER]).toBe(callerCorrelationId);
  });

  it("generates a new x-correlation-id when caller supplies an invalid value", async () => {
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, "bad value with spaces");
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(UUID_RE);
  });

  it("generates a new x-correlation-id when caller supplies an empty string", async () => {
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, "");
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(UUID_RE);
  });

  it("generates a new x-correlation-id when caller supplies a value > 128 chars", async () => {
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, "a".repeat(129));
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(UUID_RE);
  });

  it("always generates a fresh x-request-id even when correlation ID is supplied", async () => {
    const callerCorrelationId = "my-trace-id";
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, callerCorrelationId);
    // request-id must be a server-generated UUID, not the caller value
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_RE);
    expect(res.headers[REQUEST_ID_HEADER]).not.toBe(callerCorrelationId);
  });

  it("generates unique x-request-id values across requests", async () => {
    const [r1, r2] = await Promise.all([
      request(app).get("/echo"),
      request(app).get("/echo"),
    ]);
    expect(r1.headers[REQUEST_ID_HEADER]).not.toBe(r2.headers[REQUEST_ID_HEADER]);
  });

  it("generates unique x-correlation-id values when none is supplied", async () => {
    const [r1, r2] = await Promise.all([
      request(app).get("/echo"),
      request(app).get("/echo"),
    ]);
    expect(r1.headers[CORRELATION_ID_HEADER]).not.toBe(
      r2.headers[CORRELATION_ID_HEADER],
    );
  });
});

// ---------------------------------------------------------------------------
// correlationIdMiddleware – request object augmentation
// ---------------------------------------------------------------------------

describe("correlationIdMiddleware – req augmentation", () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeEchoApp();
  });

  it("attaches correlationId to req", async () => {
    const res = await request(app).get("/echo");
    expect(res.body.correlationId).toBeDefined();
    expect(res.body.correlationId).toMatch(UUID_RE);
  });

  it("attaches requestId to req", async () => {
    const res = await request(app).get("/echo");
    expect(res.body.requestId).toBeDefined();
    expect(res.body.requestId).toMatch(UUID_RE);
  });

  it("req.correlationId matches the response header", async () => {
    const res = await request(app).get("/echo");
    expect(res.body.correlationId).toBe(res.headers[CORRELATION_ID_HEADER]);
  });

  it("req.requestId matches the response header", async () => {
    const res = await request(app).get("/echo");
    expect(res.body.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it("req.correlationId reflects a valid caller-supplied value", async () => {
    const id = "caller-supplied-id";
    const res = await request(app)
      .get("/echo")
      .set(CORRELATION_ID_HEADER, id);
    expect(res.body.correlationId).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// Integration – full app (createApp)
// ---------------------------------------------------------------------------

describe("correlationId – full app integration", () => {
  let app: express.Application;

  beforeAll(() => {
    app = createApp();
  });

  it("/health returns x-correlation-id header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers[CORRELATION_ID_HEADER]).toBeDefined();
  });

  it("/health returns x-request-id header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  it("propagates caller correlation ID through the full app", async () => {
    const id = "e2e-trace-abc123";
    const res = await request(app)
      .get("/health")
      .set(CORRELATION_ID_HEADER, id);
    expect(res.headers[CORRELATION_ID_HEADER]).toBe(id);
  });

  it("error responses include correlationId and requestId fields", async () => {
    // Mount a route that throws after the middleware chain is set up.
    const testApp = createApp();
    (testApp as any).get(
      "/test-error",
      (_req: Request, _res: Response, next: NextFunction) => {
        const err = new Error("boom");
        (err as any).status = 422;
        next(err);
      },
    );

    const correlationId = "error-trace-id";
    const res = await request(testApp)
      .get("/test-error")
      .set(CORRELATION_ID_HEADER, correlationId);

    expect(res.status).toBe(422);
    expect(res.body.correlationId).toBe(correlationId);
    expect(res.body.requestId).toMatch(UUID_RE);
  });

  it("each request gets a unique x-request-id", async () => {
    const [r1, r2] = await Promise.all([
      request(app).get("/health"),
      request(app).get("/health"),
    ]);
    expect(r1.headers[REQUEST_ID_HEADER]).not.toBe(r2.headers[REQUEST_ID_HEADER]);
  });
});

// ---------------------------------------------------------------------------
// Header injection protection
// ---------------------------------------------------------------------------

describe("correlationId – header injection protection", () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeEchoApp();
  });

  it("rejects newline in correlation ID and generates a safe UUID", async () => {
    // supertest strips actual CRLF from headers, so we test via isValidId directly
    expect(isValidId("id\nX-Evil: injected")).toBe(false);
  });

  it("rejects null bytes in correlation ID", () => {
    expect(isValidId("id\x00null")).toBe(false);
  });

  it("rejects correlation IDs with angle brackets", () => {
    expect(isValidId("<script>alert(1)</script>")).toBe(false);
  });
});
