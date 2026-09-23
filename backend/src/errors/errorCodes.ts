/**
 * Canonical application error codes.
 *
 * Every code maps to a default HTTP status so callers can
 * surface consistent, auditable responses.  Add new codes
 * here rather than sprinkling numeric status literals across
 * services.
 */
export enum ErrorCode {
  // ── Authentication / Authorization ──────────────────────────────────────
  /** 401 — The request lacks valid authentication credentials. */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** 403 — The authenticated caller does not have permission. */
  FORBIDDEN = 'FORBIDDEN',
  /** 401 — Generic authentication failure (legacy alias). */
  AUTH_ERROR = 'AUTH_ERROR',

  // ── Trade / Domain ─────────────────────────────────────────────────────
  TRADE_NOT_FOUND = 'TRADE_NOT_FOUND',
  TRADE_ACCESS_DENIED = 'TRADE_ACCESS_DENIED',
  TRADE_INVALID_STATE = 'TRADE_INVALID_STATE',
  TRADE_INVALID_STATUS = 'TRADE_INVALID_STATUS',
  TRADE_BUILD_FAILED = 'TRADE_BUILD_FAILED',
  DISPUTE_NOT_FOUND = 'DISPUTE_NOT_FOUND',
  DISPUTE_INVALID_CATEGORY = 'DISPUTE_INVALID_CATEGORY',
  DISPUTE_STATUS_TRANSITION_INVALID = 'DISPUTE_STATUS_TRANSITION_INVALID',
  DISPUTE_STATUS_CONFLICT = 'DISPUTE_STATUS_CONFLICT',

  // ── Validation / Client ────────────────────────────────────────────────
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',

  // ── Payment Provider ───────────────────────────────────────────────────
  PAYMENT_PROVIDER_ERROR = 'PAYMENT_PROVIDER_ERROR',
  PAYMENT_PROVIDER_TIMEOUT = 'PAYMENT_PROVIDER_TIMEOUT',
  PAYMENT_INSUFFICIENT_FUNDS = 'PAYMENT_INSUFFICIENT_FUNDS',

  // ── Server / Infrastructure ────────────────────────────────────────────
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INFRA_ERROR = 'INFRA_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DOMAIN_ERROR = 'DOMAIN_ERROR',
}

/**
 * Default HTTP status for every {@link ErrorCode}.
 *
 * Individual handlers may override this via `AppError` constructor
 * but the mapping below is the source of truth for automatic
 * serialization.
 */
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  // Auth
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.AUTH_ERROR]: 401,

  // Trade / Domain
  [ErrorCode.TRADE_NOT_FOUND]: 404,
  [ErrorCode.TRADE_ACCESS_DENIED]: 403,
  [ErrorCode.TRADE_INVALID_STATE]: 409,
  [ErrorCode.TRADE_INVALID_STATUS]: 400,
  [ErrorCode.TRADE_BUILD_FAILED]: 500,
  [ErrorCode.DISPUTE_NOT_FOUND]: 404,
  [ErrorCode.DISPUTE_INVALID_CATEGORY]: 400,
  [ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID]: 422,
  [ErrorCode.DISPUTE_STATUS_CONFLICT]: 409,

  // Validation / Client
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.DUPLICATE_REQUEST]: 409,

  // Payment Provider
  [ErrorCode.PAYMENT_PROVIDER_ERROR]: 503,
  [ErrorCode.PAYMENT_PROVIDER_TIMEOUT]: 504,
  [ErrorCode.PAYMENT_INSUFFICIENT_FUNDS]: 402,

  // Server
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.INFRA_ERROR]: 503,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.DOMAIN_ERROR]: 500,
};
