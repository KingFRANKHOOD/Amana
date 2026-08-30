import express from "express";
import request from "supertest";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { errorHandler, ERROR_CORRELATION_ID_HEADER } from "../middleware/errorHandler";
import { ServiceErrorConverter, ServiceType } from "../errors/serviceErrorConverter";
import { appLogger } from "../middleware/logger";

describe("Structured Error Logging for Business Logic Errors (#1097)", () => {
  describe("AppError Context & Correlation ID", () => {
    it("should instantiate AppError with auto-generated errorCorrelationId", () => {
      const err = new AppError(ErrorCode.TRADE_INVALID_STATUS, "Invalid status", 400);

      expect(err.errorCorrelationId).toBeDefined();
      expect(err.errorCorrelationId).toMatch(/^err_/);
      expect(err.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
      expect(err.statusCode).toBe(400);
    });

    it("should support fluent context builders (.withTrade, .withUser, .withOperation)", () => {
      const err = new AppError(ErrorCode.TRADE_NOT_FOUND, "Trade not found", 404)
        .withTrade("trade_abc123")
        .withUser("user_xyz789")
        .withOperation("trade.get_status");

      expect(err.tradeId).toBe("trade_abc123");
      expect(err.userId).toBe("user_xyz789");
      expect(err.operation).toBe("trade.get_status");

      const payload = err.toPayload("/api/v1/trades/trade_abc123", "req-1", "corr-1");
      expect(payload.tradeId).toBe("trade_abc123");
      expect(payload.userId).toBe("user_xyz789");
      expect(payload.operation).toBe("trade.get_status");
      expect(payload.errorCorrelationId).toBe(err.errorCorrelationId);
      expect(payload.path).toBe("/api/v1/trades/trade_abc123");
    });

    it("should extract tradeId and userId passed in details object", () => {
      const err = new AppError(ErrorCode.DISPUTE_NOT_FOUND, "Dispute not found", 404, {
        tradeId: "trade_456",
        userId: "user_789",
        operation: "dispute.fetch",
      });

      expect(err.tradeId).toBe("trade_456");
      expect(err.userId).toBe("user_789");
      expect(err.operation).toBe("dispute.fetch");
    });
  });

  describe("ServiceErrorConverter Structured Context", () => {
    it("should propagate structured context through convertToAppError", () => {
      const originalErr = new Error("connection reset by peer");
      const appErr = ServiceErrorConverter.convertToAppError(
        originalErr,
        ServiceType.STELLAR,
        {
          operation: "stellar.load_account",
          tradeId: "trade_999",
          userId: "user_111",
        }
      );

      expect(appErr).toBeInstanceOf(AppError);
      expect(appErr.operation).toBe("stellar.load_account");
      expect(appErr.tradeId).toBe("trade_999");
      expect(appErr.userId).toBe("user_111");
      expect(appErr.errorCorrelationId).toMatch(/^err_/);
    });
  });

  describe("errorHandler Middleware Logging & Headers", () => {
    let app: express.Application;
    let loggerWarnSpy: jest.SpyInstance;
    let loggerErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      loggerWarnSpy = jest.spyOn(appLogger, "warn").mockImplementation(() => undefined as any);
      loggerErrorSpy = jest.spyOn(appLogger, "error").mockImplementation(() => undefined as any);

      app.get("/test-business-error", (_req, _res, next) => {
        const err = new AppError(ErrorCode.TRADE_INVALID_STATUS, "Trade status invalid", 400)
          .withTrade("trade_abc")
          .withUser("user_buyer")
          .withOperation("trade.cancel");
        next(err);
      });

      app.get("/trades/:id", (req, _res, next) => {
        (req as any).userId = "user_inferred";
        next(new AppError(ErrorCode.DISPUTE_NOT_FOUND, "Dispute not found", 404));
      });

      app.get("/test-500-error", (_req, _res, next) => {
        next(new Error("Database disk full"));
      });

      app.use(errorHandler);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return X-Error-Correlation-Id header and structured payload for AppError", async () => {
      const res = await request(app).get("/test-business-error");

      expect(res.status).toBe(400);
      expect(res.headers[ERROR_CORRELATION_ID_HEADER]).toBeDefined();
      expect(res.headers[ERROR_CORRELATION_ID_HEADER]).toMatch(/^err_/);

      expect(res.body).toMatchObject({
        code: ErrorCode.TRADE_INVALID_STATUS,
        message: "Trade status invalid",
        tradeId: "trade_abc",
        userId: "user_buyer",
        operation: "trade.cancel",
        errorCorrelationId: res.headers[ERROR_CORRELATION_ID_HEADER],
      });

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCorrelationId: res.headers[ERROR_CORRELATION_ID_HEADER],
          tradeId: "trade_abc",
          userId: "user_buyer",
          operation: "trade.cancel",
          statusCode: 400,
        }),
        expect.stringContaining("Business logic error handled")
      );
    });

    it("should infer tradeId and userId from request parameters and auth context", async () => {
      const res = await request(app).get("/trades/TRD_9999");

      expect(res.status).toBe(404);
      expect(res.body.tradeId).toBe("TRD_9999");
      expect(res.body.userId).toBe("user_inferred");
    });

    it("should log unhandled 500 errors with errorCorrelationId and return structured error", async () => {
      const res = await request(app).get("/test-500-error");

      expect(res.status).toBe(500);
      expect(res.headers[ERROR_CORRELATION_ID_HEADER]).toBeDefined();
      expect(res.body.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(res.body.errorCorrelationId).toBeDefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCorrelationId: res.headers[ERROR_CORRELATION_ID_HEADER],
          statusCode: 500,
        }),
        expect.stringContaining("UNHANDLED_ERROR")
      );
    });
  });
});
