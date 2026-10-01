import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { ErrorCode } from '../errors/errorCodes';
import { StructuredErrorPayload } from '../errors/appError';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, TracedRequest } from './correlationId.middleware';
import { appLogger } from './logger';

export const ERROR_CORRELATION_ID_HEADER = 'x-error-correlation-id';

const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]+/g;

export function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(CONTROL_CHARS_PATTERN, " ").trim();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizeValue(entry);
    }
    return result;
  }
  return value;
}

export function validateRequest(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (result.success) {
      req.body = result.data.body;
      req.query = result.data.query;
      req.params = result.data.params;
      return next();
    }

    const traced = req as TracedRequest;
    const correlationId =
      traced.correlationId ||
      (res.getHeader(CORRELATION_ID_HEADER) as string | undefined);
    const requestId =
      traced.requestId ||
      (res.getHeader(REQUEST_ID_HEADER) as string | undefined);
    const path = req.path;
    const method = req.method;

    const inferredUserId =
      (req as any).user?.id ||
      (req as any).user?.address ||
      (req as any).userId ||
      undefined;

    const pathMatch = req.path ? req.path.match(/(?:trades|disputes)\/([^/]+)/i) : null;
    const inferredTradeId =
      req.params?.tradeId ||
      req.params?.id ||
      (req.body && typeof req.body === 'object' ? req.body.tradeId : undefined) ||
      (pathMatch ? pathMatch[1] : undefined);

    const errorCorrelationId = `err_${randomUUID()}`;
    if (typeof res.setHeader === 'function') {
      res.setHeader(ERROR_CORRELATION_ID_HEADER, errorCorrelationId);
    }

    const issues = result.error.errors;

    appLogger.warn(
      {
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
        errors: issues,
      },
      '[VALIDATION_ERROR] Request schema validation failed',
    );

    const payload: StructuredErrorPayload = {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: { errors: issues },
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
  };
}
