import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Header names used for distributed tracing.
 *
 * - `x-correlation-id`: Logical trace ID that spans multiple services.
 *   Callers may supply this header; if absent one is generated.
 * - `x-request-id`: Unique ID for this specific HTTP request/response pair.
 *   Always generated server-side and never trusted from the caller.
 */
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Express middleware that attaches correlation and request IDs to every
 * request and echoes them back in the response headers.
 *
 * Downstream code can read the IDs via:
 *   req.correlationId  – logical trace ID (propagated from caller or new)
 *   req.requestId      – per-request unique ID (always server-generated)
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Accept caller-supplied correlation ID but sanitise it.
  const incoming = req.headers[CORRELATION_ID_HEADER];
  const rawCorrelationId = Array.isArray(incoming) ? incoming[0] : incoming;
  const correlationId = isValidId(rawCorrelationId)
    ? rawCorrelationId!
    : randomUUID();

  // Request ID is always server-generated – never trust the caller.
  const requestId = randomUUID();

  // Attach to request object for use in controllers / services.
  (req as TracedRequest).correlationId = correlationId;
  (req as TracedRequest).requestId = requestId;

  // Echo back in response so clients can correlate logs.
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}

/**
 * Validates that a caller-supplied ID is a non-empty string of safe
 * characters (alphanumeric, hyphens, underscores) with a max length of 128.
 * This prevents header-injection attacks.
 */
export function isValidId(value: string | undefined): value is string {
  if (!value || typeof value !== "string") return false;
  if (value.length > 128) return false;
  return /^[\w\-]+$/.test(value);
}

/**
 * Augmented Express Request type that carries tracing IDs.
 * Import this wherever you need typed access to the IDs.
 */
export interface TracedRequest extends Request {
  correlationId: string;
  requestId: string;
}
