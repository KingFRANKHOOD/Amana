import { Request, Response, NextFunction } from 'express';
import { appLogger } from './logger';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripKeys(
  obj: unknown,
  allowedFields: string[] | undefined,
  depth: number,
  stripped: string[],
): unknown {
  if (depth > 20 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => stripKeys(item, undefined, depth + 1, stripped));
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
    result[key] = stripKeys(
      (obj as Record<string, unknown>)[key],
      undefined,
      depth + 1,
      stripped,
    );
  }
  return result;
}

export function sanitizeBody(allowedFields?: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body && typeof req.body === 'object') {
      const stripped: string[] = [];
      req.body = stripKeys(req.body, allowedFields, 0, stripped);
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
