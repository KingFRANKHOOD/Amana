export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
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

export interface StructuredErrorPayload {
  code: ErrorCode | string;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  path?: string;
  requestId?: string;
  correlationId?: string;
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode | string,
    public message: string,
    public statusCode: number = 400,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AppError";
  }

  toPayload(path?: string, requestId?: string, correlationId?: string): StructuredErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: new Date().toISOString(),
      ...(path && { path }),
      ...(requestId && { requestId }),
      ...(correlationId && { correlationId }),
    };
  }
}

/**
 * Robust AppError type guard.
 *
 * `error instanceof AppError` can return `false` for an AppError that crossed a
 * module or async boundary (e.g. a duplicated module instance under bundling or
 * transpilation), which would cause callers to drop the error's real
 * `statusCode`/`message` and fall back to a generic response. `AuthService`
 * already recognises AppError by `name`; this guard applies the same structural
 * check everywhere so a failed authorization keeps its intended status code and
 * message instead of being masked as a generic 401.
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
