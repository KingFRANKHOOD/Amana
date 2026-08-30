import { randomUUID } from "crypto";

export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  FORBIDDEN = "FORBIDDEN",
  DOMAIN_ERROR = "DOMAIN_ERROR",
  INFRA_ERROR = "INFRA_ERROR",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  // Transaction-specific codes
  TRADE_NOT_FOUND = "TRADE_NOT_FOUND",
  TRADE_ACCESS_DENIED = "TRADE_ACCESS_DENIED",
  TRADE_INVALID_STATUS = "TRADE_INVALID_STATUS",
  TRADE_BUILD_FAILED = "TRADE_BUILD_FAILED",
  // Dispute-specific codes
  DISPUTE_INVALID_CATEGORY = "DISPUTE_INVALID_CATEGORY",
  DISPUTE_STATUS_TRANSITION_INVALID = "DISPUTE_STATUS_TRANSITION_INVALID",
  DISPUTE_STATUS_CONFLICT = "DISPUTE_STATUS_CONFLICT",
  DISPUTE_NOT_FOUND = "DISPUTE_NOT_FOUND",
  // Payment provider codes
  PAYMENT_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR",
  PAYMENT_PROVIDER_TIMEOUT = "PAYMENT_PROVIDER_TIMEOUT",
  PAYMENT_INSUFFICIENT_FUNDS = "PAYMENT_INSUFFICIENT_FUNDS",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
}

export interface StructuredErrorContext {
  tradeId?: string;
  userId?: string;
  operation?: string;
  errorCorrelationId?: string;
  [key: string]: unknown;
}

export interface StructuredErrorPayload {
  code: ErrorCode | string;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  path?: string;
  requestId?: string;
  correlationId?: string;
  errorCorrelationId?: string;
  tradeId?: string;
  userId?: string;
  operation?: string;
}

export class AppError extends Error {
  public tradeId?: string;
  public userId?: string;
  public operation?: string;
  public errorCorrelationId: string;

  constructor(
    public code: ErrorCode | string,
    public message: string,
    public statusCode: number = 400,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AppError";

    // Extract first-class fields from details if supplied there
    if (typeof details.tradeId === "string") this.tradeId = details.tradeId;
    if (typeof details.userId === "string") this.userId = details.userId;
    if (typeof details.operation === "string") this.operation = details.operation;
    if (typeof details.errorCorrelationId === "string") {
      this.errorCorrelationId = details.errorCorrelationId;
    } else {
      this.errorCorrelationId = `err_${randomUUID()}`;
    }
  }

  /**
   * Attach additional structured business context to the error
   */
  withContext(context: StructuredErrorContext): this {
    if (context.tradeId) this.tradeId = context.tradeId;
    if (context.userId) this.userId = context.userId;
    if (context.operation) this.operation = context.operation;
    if (context.errorCorrelationId) this.errorCorrelationId = context.errorCorrelationId;

    this.details = {
      ...this.details,
      ...context,
    };
    return this;
  }

  withTrade(tradeId: string): this {
    this.tradeId = tradeId;
    this.details.tradeId = tradeId;
    return this;
  }

  withUser(userId: string): this {
    this.userId = userId;
    this.details.userId = userId;
    return this;
  }

  withOperation(operation: string): this {
    this.operation = operation;
    this.details.operation = operation;
    return this;
  }

  toPayload(path?: string, requestId?: string, correlationId?: string): StructuredErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: new Date().toISOString(),
      errorCorrelationId: this.errorCorrelationId,
      ...(this.tradeId && { tradeId: this.tradeId }),
      ...(this.userId && { userId: this.userId }),
      ...(this.operation && { operation: this.operation }),
      ...(path && { path }),
      ...(requestId && { requestId }),
      ...(correlationId && { correlationId }),
    };
  }
}

/**
 * Robust AppError type guard.
 */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AppError" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
