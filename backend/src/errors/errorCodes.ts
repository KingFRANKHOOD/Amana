/**
 * Canonical error codes and HTTP status mapping for the backend.
 *
 * NOTE: `AppError`, `isAppError` and `StructuredErrorPayload` live in
 * `./appError` but are re-exported here for backwards compatibility with the
 * many consumers that import them from `../errors/errorCodes`.
 */
export enum ErrorCode {
  // Auth
  AUTH_ERROR = 'AUTH_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',

  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_FIELD = 'MISSING_FIELD',

  // Resources
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Domain / infrastructure
  DOMAIN_ERROR = 'DOMAIN_ERROR',
  INFRA_ERROR = 'INFRA_ERROR',

  // Trades
  TRADE_BUILD_FAILED = 'TRADE_BUILD_FAILED',
  TRADE_INVALID_STATUS = 'TRADE_INVALID_STATUS',

  // Disputes
  DISPUTE_INVALID_CATEGORY = 'DISPUTE_INVALID_CATEGORY',
  DISPUTE_STATUS_TRANSITION_INVALID = 'DISPUTE_STATUS_TRANSITION_INVALID',
  DISPUTE_STATUS_CONFLICT = 'DISPUTE_STATUS_CONFLICT',

  // Payments
  PAYMENT_PROVIDER_ERROR = 'PAYMENT_PROVIDER_ERROR',
  PAYMENT_PROVIDER_TIMEOUT = 'PAYMENT_PROVIDER_TIMEOUT',
  PAYMENT_INSUFFICIENT_FUNDS = 'PAYMENT_INSUFFICIENT_FUNDS',

  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.AUTH_ERROR]: 401,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,

  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.MISSING_FIELD]: 400,

  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.ALREADY_EXISTS]: 409,

  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,

  [ErrorCode.DOMAIN_ERROR]: 400,
  [ErrorCode.INFRA_ERROR]: 500,

  [ErrorCode.TRADE_BUILD_FAILED]: 400,
  [ErrorCode.TRADE_INVALID_STATUS]: 409,

  [ErrorCode.DISPUTE_INVALID_CATEGORY]: 400,
  [ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID]: 409,
  [ErrorCode.DISPUTE_STATUS_CONFLICT]: 409,

  [ErrorCode.PAYMENT_PROVIDER_ERROR]: 502,
  [ErrorCode.PAYMENT_PROVIDER_TIMEOUT]: 504,
  [ErrorCode.PAYMENT_INSUFFICIENT_FUNDS]: 402,

  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

// Re-export the canonical error primitives so existing imports from
// `../errors/errorCodes` keep resolving (issue #1393).
export { AppError, isAppError } from './appError';
export type { StructuredErrorPayload } from './appError';
