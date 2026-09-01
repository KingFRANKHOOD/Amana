import { ErrorCode, ERROR_STATUS_MAP } from './errorCodes.js';

/**
 * Standardised application error.
 *
 * Every thrown error in the backend should be (or be wrapped in) an
 * `AppError` so the global error handler can serialise a consistent
 * `{ error: { code, message, statusCode, ... } }` payload.
 */
export class AppError extends Error {
  /** Machine-readable error code. */
  readonly code: ErrorCode;

  /** HTTP status derived from the code (or overridden). */
  readonly statusCode: number;

  /** Optional structured details (e.g. validation field errors). */
  readonly details?: Array<{ field: string; issue: string }>;

  constructor(
    message: string,
    opts: {
      code?: ErrorCode;
      statusCode?: number;
      details?: Array<{ field: string; issue: string }>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code ?? ErrorCode.INTERNAL_ERROR;
    this.statusCode = opts.statusCode ?? ERROR_STATUS_MAP[this.code] ?? 500;
    this.details = opts.details;
  }

  /** Convenience: return a plain object suitable for JSON serialisation. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ── Convenience helpers ──────────────────────────────────────────────────

export function forbidden(message = 'Forbidden') {
  return new AppError(message, { code: ErrorCode.FORBIDDEN });
}

export function unauthorized(message = 'Unauthorized') {
  return new AppError(message, { code: ErrorCode.UNAUTHORIZED });
}

export function notFound(message = 'Not found') {
  return new AppError(message, { code: ErrorCode.NOT_FOUND });
}

export function validationError(
  message = 'Validation error',
  details?: Array<{ field: string; issue: string }>,
) {
  return new AppError(message, { code: ErrorCode.VALIDATION_ERROR, details });
}
