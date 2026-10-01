import { Request, Response, NextFunction } from 'express';
import { appLogger } from './logger';

/**
 * Security policy for request sanitization:
 * - strip prototype-pollution keys globally before any route handler sees the payload
 * - normalize control characters and trim untrusted string values without HTML-escaping them
 * - do not rewrite auth, JWT, signature, cookie, hash, raw-body, or protocol values
 * - route-level validation handles path/query/body field semantics and XSS rejection where needed
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_HEADER_PATTERN = /(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-webhook-signature|x-hub-signature|x-signature|digest|secret|jwt|token)/i;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]+/g;

function normalizeStringValue(value: string): string {
  return value.replace(CONTROL_CHARS_PATTERN, ' ').trim();
}

function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_PATTERN.test(name);
}

function stripDangerousKeys(
  obj: unknown,
  allowedFields: string[] | undefined,
  depth: number,
  stripped: string[],
): unknown {
  if (depth > 20 || obj === null || typeof obj !== 'object' || Buffer.isBuffer(obj)) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => stripDangerousKeys(item, undefined, depth + 1, stripped));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      stripped.push(key);
      continue;
    }
    if (allowedFields && depth === 0 && !allowedFields.includes(key)) {
      stripped.push(key);
      continue;
    }

    result[key] = stripDangerousKeys(
      (obj as Record<string, unknown>)[key],
      undefined,
      depth + 1,
      stripped,
    );
  }

  return result;
}

function sanitizeObjectValues(
  obj: unknown,
  depth: number,
  stripped: string[],
  mode: 'body' | 'query' | 'params' | 'headers' = 'body',
): unknown {
  if (depth > 20 || obj === null || typeof obj !== 'object' || Buffer.isBuffer(obj)) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObjectValues(item, depth + 1, stripped, mode));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) {
      stripped.push(key);
      continue;
    }

    const value = (obj as Record<string, unknown>)[key];
    if (mode === 'headers' && isSensitiveHeader(key)) {
      result[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      result[key] = normalizeStringValue(value);
      continue;
    }

    result[key] = sanitizeObjectValues(value, depth + 1, stripped, mode);
  }

  return result;
}

export function sanitizeBody(allowedFields?: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      const stripped: string[] = [];
      req.body = stripDangerousKeys(req.body, allowedFields, 0, stripped) as typeof req.body;
      if (stripped.length > 0) {
        appLogger.warn(
          { path: req.path, stripped },
          'Sanitizer stripped fields from request body',
        );
      }
    }
    next();
  };
}

export function sanitizeRequestInput() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const stripped: string[] = [];

    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      req.body = sanitizeObjectValues(req.body, 0, stripped, 'body') as typeof req.body;
    }

    if (req.query && typeof req.query === 'object') {
      const sanitizedQuery = sanitizeObjectValues(req.query, 0, stripped, 'query') as typeof req.query;
      Object.defineProperty(req, 'query', {
        value: sanitizedQuery,
        writable: true,
        configurable: true,
      });
    }

    if (req.params && typeof req.params === 'object') {
      const sanitizedParams = sanitizeObjectValues(req.params, 0, stripped, 'params') as typeof req.params;
      Object.defineProperty(req, 'params', {
        value: sanitizedParams,
        writable: true,
        configurable: true,
      });
    }

    if (req.headers && typeof req.headers === 'object') {
      const sanitizedHeaders = sanitizeObjectValues(req.headers, 0, stripped, 'headers') as Record<string, string | string[] | undefined>;
      Object.keys(req.headers).forEach((key) => {
        delete (req.headers as Record<string, unknown>)[key];
      });
      Object.assign(req.headers, sanitizedHeaders);
    }

    if (stripped.length > 0) {
      appLogger.warn(
        { path: req.path, stripped },
        'Sanitizer stripped dangerous request input values',
      );
    }

    next();
  };
}
