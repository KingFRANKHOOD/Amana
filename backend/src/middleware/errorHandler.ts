import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { AppError, ErrorCode, StructuredErrorPayload, isAppError } from '../errors/errorCodes';
import { isHttpError } from '../errors/httpError';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, TracedRequest } from './correlationId.middleware';
import { appLogger } from './logger';
import { TracingHelper } from '../config/tracing';

export const ERROR_CORRELATION_ID_HEADER = 'x-error-correlation-id';

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
  const method = req.method;

  // Infer user context from request if available
  const inferredUserId =
    (req as any).user?.id ||
    (req as any).user?.address ||
    (req as any).userId ||
    undefined;

  // Infer tradeId from params, body, or path if available
  const pathMatch = req.path ? req.path.match(/(?:trades|disputes)\/([^/]+)/i) : null;
  const inferredTradeId =
    req.params?.tradeId ||
    req.params?.id ||
    (req.body && typeof req.body === 'object' ? req.body.tradeId : undefined) ||
    (pathMatch ? pathMatch[1] : undefined);

  if (isAppError(err)) {
    const appErr = err as AppError;

    // Attach contextual fields if not already explicitly present on the error
    if (!appErr.tradeId && inferredTradeId) appErr.tradeId = inferredTradeId;
    if (!appErr.userId && inferredUserId) appErr.userId = inferredUserId;
    if (!appErr.operation) appErr.operation = `${method} ${path}`;

    if (typeof res.setHeader === 'function') {
      res.setHeader(ERROR_CORRELATION_ID_HEADER, appErr.errorCorrelationId);
    }

    const logData = {
      errorCorrelationId: appErr.errorCorrelationId,
      code: appErr.code,
      message: appErr.message,
      statusCode: appErr.statusCode,
      tradeId: appErr.tradeId,
      userId: appErr.userId,
      operation: appErr.operation,
      requestId,
      correlationId,
      path,
      method,
      details: appErr.details,
      stack: appErr.stack,
    };

    if (appErr.statusCode >= 500) {
      appLogger.error(logData, `[${appErr.code}] Business logic error (5xx)`);
    } else {
      appLogger.warn(logData, `[${appErr.code}] Business logic error handled`);
    }

    TracingHelper.setAttributes({
      'error.correlation_id': appErr.errorCorrelationId,
      'error.code': String(appErr.code),
      ...(appErr.tradeId && { 'trade.id': appErr.tradeId }),
      ...(appErr.userId && { 'user.id': appErr.userId }),
      ...(appErr.operation && { 'operation.name': appErr.operation }),
    });

    const payload = appErr.toPayload(path, requestId, correlationId);
    return res.status(appErr.statusCode).json(payload);
  }

  if (err instanceof z.ZodError) {
    const errorCorrelationId = `err_${randomUUID()}`;
    if (typeof res.setHeader === 'function') {
      res.setHeader(ERROR_CORRELATION_ID_HEADER, errorCorrelationId);
    }

    const logData = {
      errorCorrelationId,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      statusCode: 400,
      tradeId: inferredTradeId,
      userId: inferredUserId,
      operation: `${method} ${path}`,
      requestId,
      correlationId,
      path,
      method,
      errors: err.errors,
    };

    appLogger.warn(logData, '[VALIDATION_ERROR] Request schema validation failed');

    TracingHelper.setAttributes({
      'error.correlation_id': errorCorrelationId,
      'error.code': ErrorCode.VALIDATION_ERROR,
    });

    const payload: StructuredErrorPayload = {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: { errors: err.errors },
      timestamp: new Date().toISOString(),
      path,
      errorCorrelationId,
      ...(inferredTradeId && { tradeId: inferredTradeId }),
      ...(inferredUserId && { userId: inferredUserId }),
      operation: `${method} ${path}`,
      ...(correlationId && { correlationId }),
      ...(requestId && { requestId }),
    };
    return res.status(400).json(payload);
  }

  const errorCorrelationId = `err_${randomUUID()}`;
  if (typeof res.setHeader === 'function') {
    res.setHeader(ERROR_CORRELATION_ID_HEADER, errorCorrelationId);
  }

  const status = isHttpError(err) ? err.status : 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : (err instanceof Error ? err.message : String(err));
  const errForLogging = err instanceof Error ? err : new Error(String(err));

  appLogger.error({
    errorCorrelationId,
    err: errForLogging,
    statusCode: status,
    tradeId: inferredTradeId,
    userId: inferredUserId,
    operation: `${method} ${path}`,
    requestId,
    correlationId,
    path,
    method,
    stack: errForLogging.stack,
  }, `[UNHANDLED_ERROR] ${errForLogging.message}`);

  TracingHelper.recordException(errForLogging);
  TracingHelper.setAttributes({
    'error.correlation_id': errorCorrelationId,
    'error.code': ErrorCode.INTERNAL_ERROR,
    ...(inferredTradeId && { 'trade.id': inferredTradeId }),
    ...(inferredUserId && { 'user.id': inferredUserId }),
  });

  const payload: StructuredErrorPayload = {
    code: ErrorCode.INTERNAL_ERROR,
    message,
    details: {},
    timestamp: new Date().toISOString(),
    path,
    errorCorrelationId,
    ...(inferredTradeId && { tradeId: inferredTradeId }),
    ...(inferredUserId && { userId: inferredUserId }),
    operation: `${method} ${path}`,
    ...(correlationId && { correlationId }),
    ...(requestId && { requestId }),
  };

  res.status(status).json(payload);
}
