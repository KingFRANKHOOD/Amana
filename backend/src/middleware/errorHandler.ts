import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError, ErrorCode, StructuredErrorPayload, isAppError } from '../errors/errorCodes';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, TracedRequest } from './correlationId.middleware';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const traced = req as TracedRequest;

  const correlationId =
    traced.correlationId ||
    (res.getHeader(CORRELATION_ID_HEADER) as string | undefined);
  const requestId =
    traced.requestId ||
    (res.getHeader(REQUEST_ID_HEADER) as string | undefined);
  const path = req.path;

  // Handle structured AppErrors with a consistent payload
  if (isAppError(err)) {
    const appErr = err as AppError;
    const payload = appErr.toPayload(path, requestId, correlationId);
    return res.status(appErr.statusCode).json(payload);
  }

  const status = (err && typeof (err as any).status === 'number') ? (err as any).status : 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : (err instanceof Error ? err.message : String(err));

  const payload: StructuredErrorPayload = {
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: {},
    timestamp: new Date().toISOString(),
    path,
    ...(correlationId && { correlationId }),
    ...(requestId && { requestId }),
  };

  res.status(status).json(payload);
}
