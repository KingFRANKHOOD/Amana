import { randomUUID } from 'crypto';
import { ErrorCode, ERROR_STATUS_MAP } from './errorCodes';

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode) as string[]);

/**
 * Standardised application error.
 *
 * Every thrown error in the backend should be (or be wrapped in) an
 * `AppError` so the global error handler can serialise a consistent
 * `{ error: { code, message, statusCode, ... } }` payload.
 *
 * Supports both the new signature `new AppError(message, { code, statusCode })`
 * and the legacy signature `new AppError(code, message, statusCode)` used by
 * older services (dispute.service, trade.service, auth.service, etc.).
 */
export class AppError extends Error {
  /** Machine-readable error code. */
  readonly code: ErrorCode;

  /** HTTP status derived from the code (or overridden). */
  readonly statusCode: number;

  /** Optional structured details (e.g. validation field errors). */
  readonly details?: Array<{ field: string; issue: string }>;

  constructor(
    messageOrCode: string,
    optsOrMessage?: string | number | {
      code?: ErrorCode;
      statusCode?: number;
      details?: any;
      cause?: unknown;
    },
    maybeStatus?: number | any,
    maybeDetails?: any,
  ) {
    // Legacy: new AppError(code, "message", status) or with details as 4th arg
    // Supports both ErrorCode enum and arbitrary string codes (e.g. STELLAR_...)
    if (typeof optsOrMessage === 'string') {
      const code = messageOrCode as ErrorCode;
      const message = optsOrMessage;
      let statusCode: number | undefined;
      let details: any;
      if (typeof maybeStatus === 'number') {
        statusCode = maybeStatus;
        details = maybeDetails;
      } else if (typeof maybeStatus === 'object' && maybeStatus !== null) {
        details = maybeStatus;
      }
      // If code is known ErrorCode, use mapped status; otherwise use provided status or 500
      const mapped = (ERROR_STATUS_MAP as Record<string, number>)[code];
      statusCode = statusCode ?? mapped ?? 500;
      super(message, { cause: undefined });
      this.name = 'AppError';
      this.code = code;
      this.statusCode = statusCode;
      this.details = details;
      this.errorCorrelationId = `err_${randomUUID()}`;
      return;
    }

    // Legacy: new AppError(message, 403) or new AppError(code, message) with number?
    const message = messageOrCode;
    let opts: { code?: ErrorCode; statusCode?: number; details?: Array<{ field: string; issue: string }>; cause?: unknown } = {};
    if (typeof optsOrMessage === 'number') {
      opts = { statusCode: optsOrMessage };
    } else if (typeof optsOrMessage === 'object' && optsOrMessage !== null) {
      opts = optsOrMessage as any;
    } else if (typeof optsOrMessage === 'string') {
      // Should have been handled above, but fallback
      opts = {};
    }
    // If maybeStatus is provided as third arg and opts is object, treat it as status override for legacy 3-arg with string message
    if (typeof maybeStatus === 'number' && typeof optsOrMessage === 'object') {
      opts.statusCode = maybeStatus;
    }
    super(message, { cause: (opts as any)?.cause });
    this.name = 'AppError';
    this.code = (opts as any)?.code ?? ErrorCode.INTERNAL_ERROR;
    this.statusCode = (opts as any)?.statusCode ?? ERROR_STATUS_MAP[this.code] ?? 500;
    this.details = (opts as any)?.details;
    this.errorCorrelationId = `err_${randomUUID()}`;
  }

  /** Correlation id for tracing */
  readonly errorCorrelationId: string;
  tradeId?: string;
  userId?: string;
  operation?: string;

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

  withContext(context: Record<string, unknown>): this {
    if (context) {
      if (typeof context.tradeId === 'string') this.tradeId = context.tradeId as string;
      if (typeof context.userId === 'string') this.userId = context.userId as string;
      if (typeof context.operation === 'string') this.operation = context.operation as string;
      // Also merge any details
      if (context && typeof context === 'object') {
        this.details = { ...(this.details as any), ...context } as any;
      }
    }
    return this;
  }

  toPayload(path: string, requestId?: string, correlationId?: string): StructuredErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details as any,
      timestamp: new Date().toISOString(),
      path,
      errorCorrelationId: this.errorCorrelationId,
      ...(this.tradeId && { tradeId: this.tradeId }),
      ...(this.userId && { userId: this.userId }),
      ...(this.operation && { operation: this.operation }),
      ...(correlationId && { correlationId }),
      ...(requestId && { requestId }),
    };
  }
}

export interface StructuredErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
  errorCorrelationId: string;
  tradeId?: string;
  userId?: string;
  operation?: string;
  correlationId?: string;
  requestId?: string;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (
    err !== null && typeof err === 'object' &&
    (err as any).name === 'AppError' &&
    typeof (err as any).statusCode === 'number' &&
    typeof (err as any).code === 'string'
  );
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
