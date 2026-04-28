import crypto from "crypto";
import { Request, Response } from "express";
import { env } from "../config/env";
import { errorHandler } from "../middleware/errorHandler";
import { requestIdMiddleware } from "../middleware/requestId";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../middleware/correlationId.middleware";

jest.mock("pino", () => jest.fn(() => ({ mocked: true })));

const pinoHttpMock = jest.fn(() => "logger-middleware");
jest.mock("pino-http", () => pinoHttpMock);

describe("requestIdMiddleware", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("propagates caller supplied x-request-id", () => {
    const req = {
      headers: {
        "x-request-id": "caller-request-id",
      },
    } as unknown as Request;

    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe("caller-request-id");
    expect(setHeader).toHaveBeenCalledWith("X-Request-ID", "caller-request-id");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("generates and sets x-request-id when caller does not provide one", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    jest.spyOn(crypto, "randomUUID").mockReturnValue(uuid);

    const req = { headers: {} } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe(uuid);
    expect(setHeader).toHaveBeenCalledWith("X-Request-ID", uuid);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("errorHandler middleware", () => {
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    (env as any).NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  it("returns safe structured payload with tracing IDs from request", () => {
    (env as any).NODE_ENV = "development";

    const req = {
      correlationId: "corr-abc",
      requestId: "req-123",
    } as any;

    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const res = {
      status,
      json,
      getHeader: jest.fn(),
    } as any;

    const err = new Error("validation exploded");
    (err as any).status = 422;

    errorHandler(err, req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      error: true,
      status: 422,
      message: "validation exploded",
      correlationId: "corr-abc",
      requestId: "req-123",
    });
  });

  it("falls back to tracing headers when request properties are absent", () => {
    (env as any).NODE_ENV = "development";

    const req = {} as any;
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const res = {
      status,
      json,
      getHeader: jest.fn((name: string) => {
        if (name === CORRELATION_ID_HEADER) return "corr-from-header";
        if (name === REQUEST_ID_HEADER) return "req-from-header";
        return undefined;
      }),
    } as any;

    errorHandler(new Error("boom"), req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
        status: 500,
        message: "boom",
        correlationId: "corr-from-header",
        requestId: "req-from-header",
      }),
    );
  });

  it("hides internal error messages in production mode", () => {
    (env as any).NODE_ENV = "production";

    const req = {} as any;
    const status = jest.fn().mockReturnThis();
    const json = jest.fn().mockReturnThis();
    const res = {
      status,
      json,
      getHeader: jest.fn(),
    } as any;

    errorHandler(new Error("sensitive failure"), req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: true,
      status: 500,
      message: "Internal server error",
    });
  });
});

describe("logger middleware config contracts", () => {
  it("wires custom lifecycle, tracing and ignore behavior without brittle log coupling", () => {
    let loggerModule: any;

    jest.isolateModules(() => {
      loggerModule = require("../middleware/logger");
    });

    expect(pinoHttpMock).toHaveBeenCalledTimes(1);
    const calls = pinoHttpMock.mock.calls as any[];
    const options = (calls[0] ? calls[0][0] : {}) as any;

    expect(loggerModule.default).toBe("logger-middleware");

    expect(
      options.customProps({ correlationId: "corr", requestId: "req" }),
    ).toEqual({ correlationId: "corr", requestId: "req" });

    expect(options.autoLogging.ignore({ url: "/health" })).toBe(true);
    expect(options.autoLogging.ignore({ url: "/api/docs" })).toBe(true);
    expect(options.autoLogging.ignore({ url: "/trades" })).toBe(false);

    expect(options.customSuccessMessage({ method: "POST", url: "/wallet" }, { statusCode: 201 })).toBe(
      "POST /wallet 201",
    );

    expect(
      options.customErrorMessage(
        { method: "GET", url: "/trades/1" },
        { statusCode: 500 },
        new Error("db timeout"),
      ),
    ).toContain("db timeout");

    expect(
      options.serializers.req({
        method: "PATCH",
        url: "/users/me",
        raw: { correlationId: "corr-1", requestId: "req-1" },
      }),
    ).toEqual({
      method: "PATCH",
      url: "/users/me",
      [CORRELATION_ID_HEADER]: "corr-1",
      [REQUEST_ID_HEADER]: "req-1",
    });
  });
});
