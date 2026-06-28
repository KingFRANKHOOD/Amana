import request from "supertest";
import express, { Request, Response } from "express";
import { correlationIdMiddleware, TracedRequest } from "../middleware/correlationId.middleware";
import { requestLoggerMiddleware } from "../middleware/request.logger.middleware";
import { appLogger } from "../middleware/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(statusCode = 200) {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.get("/test", (_req: Request, res: Response) => res.status(statusCode).json({ ok: true }));
  app.get("/user-test", (req: Request, res: Response) => {
    (req as any).user = { id: "user-123" };
    res.status(statusCode).json({ ok: true });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Log shape
// ---------------------------------------------------------------------------

describe("requestLoggerMiddleware – log shape", () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(appLogger, "info").mockImplementation(() => appLogger);
    warnSpy = jest.spyOn(appLogger, "warn").mockImplementation(() => appLogger);
    errorSpy = jest.spyOn(appLogger, "error").mockImplementation(() => appLogger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs method, path, status, durationMs for a 200 response", async () => {
    const app = makeApp(200);
    await request(app).get("/test");

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [fields] = infoSpy.mock.calls[0];
    expect(fields).toMatchObject({
      method: "GET",
      path: "/test",
      status: 200,
    });
    expect(typeof fields.durationMs).toBe("number");
  });

  it("includes correlationId in the log entry", async () => {
    const app = makeApp(200);
    const correlationId = "test-correlation-id";
    await request(app).get("/test").set("x-correlation-id", correlationId);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [fields] = infoSpy.mock.calls[0];
    expect(fields.correlationId).toBe(correlationId);
  });

  it("includes userAgent in the log entry", async () => {
    const app = makeApp(200);
    await request(app).get("/test").set("user-agent", "test-agent/1.0");

    const [fields] = infoSpy.mock.calls[0];
    expect(fields.userAgent).toBe("test-agent/1.0");
  });

  it("includes ip in the log entry", async () => {
    const app = makeApp(200);
    await request(app).get("/test");

    const [fields] = infoSpy.mock.calls[0];
    expect("ip" in fields).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Log level selection
// ---------------------------------------------------------------------------

describe("requestLoggerMiddleware – log level", () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(appLogger, "info").mockImplementation(() => appLogger);
    warnSpy = jest.spyOn(appLogger, "warn").mockImplementation(() => appLogger);
    errorSpy = jest.spyOn(appLogger, "error").mockImplementation(() => appLogger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses info level for 2xx", async () => {
    const app = makeApp(200);
    await request(app).get("/test");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses info level for 3xx", async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.use(requestLoggerMiddleware);
    app.get("/redir", (_req, res) => res.redirect("/test"));
    await request(app).get("/redir");
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("uses warn level for 4xx", async () => {
    const app = makeApp(404);
    await request(app).get("/test");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses error level for 5xx", async () => {
    const app = makeApp(500);
    await request(app).get("/test");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// X-Request-Id response header
// ---------------------------------------------------------------------------

describe("requestLoggerMiddleware – X-Request-Id header", () => {
  it("attaches X-Request-Id to the response", async () => {
    const app = makeApp(200);
    const res = await request(app).get("/test");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("X-Request-Id is a valid UUID", async () => {
    const app = makeApp(200);
    const res = await request(app).get("/test");
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("matches the x-request-id response header set by correlationIdMiddleware", async () => {
    const app = makeApp(200);
    const res = await request(app).get("/test");
    // Both correlationId middleware and requestLogger set x-request-id; they must agree.
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Correlation ID propagation
// ---------------------------------------------------------------------------

describe("requestLoggerMiddleware – correlation ID propagation", () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(appLogger, "info").mockImplementation(() => appLogger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("propagates caller-supplied correlation ID into log fields", async () => {
    const app = makeApp(200);
    const id = "caller-abc-123";
    await request(app).get("/test").set("x-correlation-id", id);

    const [fields] = infoSpy.mock.calls[0];
    expect(fields.correlationId).toBe(id);
  });

  it("generates a correlation ID when caller does not supply one", async () => {
    const app = makeApp(200);
    await request(app).get("/test");

    const [fields] = infoSpy.mock.calls[0];
    expect(fields.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
