import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode, StructuredErrorPayload } from "./errorCodes";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = (req.headers["x-request-id"] as string) || undefined;
  const correlationId = (req.headers["x-correlation-id"] as string) || undefined;
  const path = req.path;

  if (err instanceof AppError) {
    appLogger.warn({
      code: err.code,
      message: err.message,
      requestId,
      details: err.details,
    }, "AppError handled");

    const payload = err.toPayload(path, requestId, correlationId);
    return res.status(err.statusCode).json(payload);
  }

  // Handle Zod validation errors
  if (err.name === "ZodError") {
    const payload: StructuredErrorPayload = {
      code: ErrorCode.VALIDATION_ERROR,
      message: "Validation failed",
      details: { errors: err.errors },
      timestamp: new Date().toISOString(),
      path,
      ...(requestId && { requestId }),
      ...(correlationId && { correlationId }),
    };
    return res.status(400).json(payload);
  }

  // Default unhandled error
  appLogger.error({
    err,
    requestId,
    stack: err.stack,
  }, "Unhandled error");

  const message =
    env.NODE_ENV === "production" ? "Internal server error" : err.message;

  const payload: StructuredErrorPayload = {
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: {},
    timestamp: new Date().toISOString(),
    path,
    ...(requestId && { requestId }),
    ...(correlationId && { correlationId }),
  };

  res.status(err.status || 500).json(payload);
};
