import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode, StructuredErrorPayload, isAppError } from "./errorCodes";
import { ZodError } from "zod";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = (req.headers["x-request-id"] as string) || undefined;
  const correlationId = (req.headers["x-correlation-id"] as string) || undefined;
  const path = req.path;

  if (isAppError(err)) {
    const appErr = err as AppError;
    appLogger.warn({
      code: appErr.code,
      message: appErr.message,
      requestId,
      details: appErr.details,
    }, "AppError handled");

    const payload = appErr.toPayload(path, requestId, correlationId);
    return res.status(appErr.statusCode).json(payload);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
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
    stack: err instanceof Error ? err.stack : undefined,
  }, "Unhandled error");

  const message =
    env.NODE_ENV === "production" ? "Internal server error" : (err instanceof Error ? err.message : String(err));

  const payload: StructuredErrorPayload = {
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: {},
    timestamp: new Date().toISOString(),
    path,
    ...(requestId && { requestId }),
    ...(correlationId && { correlationId }),
  };

  const status = (err && typeof (err as any).status === 'number') ? (err as any).status : 500;
  res.status(status).json(payload);
};
