import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode } from "./errorCodes";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.headers["x-request-id"];

  if (err instanceof AppError) {
    appLogger.warn({ 
      code: err.code, 
      message: err.message, 
      requestId,
      details: err.details 
    }, "AppError handled");

    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  // Handle Zod errors (if not handled by middleware)
  if (err.name === "ZodError") {
    return res.status(400).json({
      code: ErrorCode.VALIDATION_ERROR,
      message: "Validation failed",
      details: err.errors,
    });
  }

  // Default error
  appLogger.error({ 
    err, 
    requestId,
    stack: err.stack 
  }, "Unhandled error");

  const message = env.NODE_ENV === "production" ? "Internal server error" : err.message;

  res.status(err.status || 500).json({
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: {},
  });
};
