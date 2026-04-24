import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, TracedRequest } from './correlationId.middleware';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = (err as any).status || 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  const traced = req as TracedRequest;

  // Prefer the property set by correlationIdMiddleware; fall back to the
  // response header which is always set by that middleware before any route runs.
  const correlationId =
    traced.correlationId ||
    (res.getHeader(CORRELATION_ID_HEADER) as string | undefined);
  const requestId =
    traced.requestId ||
    (res.getHeader(REQUEST_ID_HEADER) as string | undefined);

  res.status(status).json({
    error: true,
    status,
    message,
    // Include tracing IDs so callers can correlate errors with backend logs.
    ...(correlationId && { correlationId }),
    ...(requestId && { requestId }),
  });
}
