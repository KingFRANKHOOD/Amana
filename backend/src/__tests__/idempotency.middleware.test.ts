import { EventEmitter } from "events";
import { Request, Response } from "express";

jest.mock("../lib/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock("../middleware/logger", () => ({
  appLogger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { redis } from "../lib/redis";
import { idempotencyMiddleware } from "../middleware/idempotency";

function createReq(
  overrides: Partial<Request> = {},
): Request {
  return {
    method: "POST",
    path: "/trades",
    headers: { "idempotency-key": "idem-1" },
    ...overrides,
  } as Request;
}

function createRes() {
  const events = new EventEmitter();
  const headers: Record<string, any> = {};

  const res = {
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = value;
    }),
    getHeaders: jest.fn(() => ({ ...headers })),
    statusCode: 200,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      this.emit("finish");
      return this;
    }),
  } as unknown as Response & EventEmitter & { body?: unknown };

  return { res, headers };
}

describe("idempotencyMiddleware", () => {
  const redisMock = redis as jest.Mocked<typeof redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.get.mockResolvedValue(null as any);
    redisMock.set.mockResolvedValue("OK" as any);
    redisMock.del.mockResolvedValue(1 as any);
  });

  it("bypasses when idempotency key is missing", async () => {
    const req = createReq({ headers: {} as any });
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("bypasses for non-mutation methods", async () => {
    const req = createReq({ method: "GET" });
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("replays cached response for duplicate/stale keys", async () => {
    redisMock.get.mockResolvedValueOnce(
      JSON.stringify({
        status: 201,
        body: { tradeId: "t-1" },
        headers: { "content-type": "application/json" },
      }) as any,
    );

    const req = createReq();
    const { res, headers } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect((res as any).body).toEqual({ tradeId: "t-1" });
    expect(headers["X-Idempotency-Cache"]).toBe("HIT");
  });

  it("caches first successful response and releases lock", async () => {
    const req = createReq();
    const { res } = createRes();

    await idempotencyMiddleware(req, res, () => {
      res.status(201).json({ ok: true });
    });

    await Promise.resolve();

    expect(redisMock.set).toHaveBeenCalledWith(
      "idempotency:/trades:idem-1",
      expect.any(String),
      "EX",
      86400,
    );
    expect(redisMock.del).toHaveBeenCalledWith("idempotency:lock:/trades:idem-1");
  });

  it("serves in-flight duplicate request from replay cache without duplicate side effects", async () => {
    let sideEffects = 0;
    let cachedPayload: string | null = null;
    let lockHeld = false;

    redisMock.get.mockImplementation(async (key: string) => {
      if (key === "idempotency:/trades:idem-1") {
        return cachedPayload as any;
      }
      return null as any;
    });

    redisMock.set.mockImplementation(async (key: string, value: string, mode: string) => {
      if (key === "idempotency:lock:/trades:idem-1" && mode === "NX") {
        if (lockHeld) return null as any;
        lockHeld = true;
        return "OK" as any;
      }

      if (key === "idempotency:/trades:idem-1") {
        cachedPayload = value;
        return "OK" as any;
      }

      return "OK" as any;
    });

    redisMock.del.mockImplementation(async (key: string) => {
      if (key === "idempotency:lock:/trades:idem-1") {
        lockHeld = false;
      }
      return 1 as any;
    });

    const req1 = createReq();
    const req2 = createReq();
    const { res: res1 } = createRes();
    const { res: res2, headers: headers2 } = createRes();

    const next1 = jest.fn(() => {
      sideEffects += 1;
      setTimeout(() => {
        res1.status(201).json({ tradeId: "created-once" });
      }, 10);
    });

    const next2 = jest.fn(() => {
      sideEffects += 1;
    });

    await Promise.all([
      idempotencyMiddleware(req1, res1, next1),
      idempotencyMiddleware(req2, res2, next2),
    ]);

    expect(sideEffects).toBe(1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(201);
    expect((res2 as any).body).toEqual({ tradeId: "created-once" });
    expect(headers2["X-Idempotency-Cache"]).toBe("HIT");
  });

  it("continues request flow when Redis storage fails", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("redis down") as any);

    const req = createReq();
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
