import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../middleware/logger';

interface RequestTimeoutOptions {
  defaultTimeoutMs: number;
  perRouteTimeouts?: Record<string, number>;
  timeoutHeaderName?: string;
  slowRequestThresholdMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_HEADER = 'X-Response-Time';
const DEFAULT_SLOW_THRESHOLD_MS = 5_000;

// Converts an Express-style route pattern such as "POST:/api/v1/trades/:id/evidence"
// into a RegExp matched against "<METHOD>:<path>". Both ":param" and "{param}" are
// supported. Escapes all regex metacharacters in literal segments.
function compileRouteKey(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/:\w+|\\\{\w+\\\}/g, '[^/]+')
    .replace(/\\\*/g, '.*');
  return new RegExp(`^${pattern}$`);
}

function perRouteTimeoutMs(
  req: Request,
  perRouteTimeouts: Record<string, number>,
  defaultMs: number
): number {
  const requestKey = `${req.method}:${req.path}`;
  for (const [key, timeout] of Object.entries(perRouteTimeouts)) {
    if (compileRouteKey(key).test(requestKey)) {
      return timeout;
    }
  }
  return defaultMs;
}

export function createRequestTimeoutMiddleware(
  options: Partial<RequestTimeoutOptions> = {}
) {
  const timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const perRouteTimeouts = options.perRouteTimeouts ?? {};
  const timeoutHeader = options.timeoutHeaderName ?? DEFAULT_TIMEOUT_HEADER;
  const slowThreshold = options.slowRequestThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;

  return (req: Request, res: Response, next: NextFunction): void => {
    const routeTimeout = perRouteTimeoutMs(req, perRouteTimeouts, timeoutMs);

    const startTime = process.hrtime.bigint();

    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        appLogger.warn(
          {
            method: req.method,
            path: req.path,
            timeoutMs: routeTimeout,
            correlationId: (req as { correlationId?: string }).correlationId,
          },
          'Request timeout exceeded'
        );
        res.status(408).json({
          error: {
            code: 'request_timeout',
            message: `Request timeout after ${routeTimeout}ms`,
          },
        });
      }
    }, routeTimeout);

    // Inject the response-time header before headers are flushed, mirroring the
    // approach used by the `response-time` package. `res.on('finish')` fires
    // after headers are sent, so setHeader() there would throw ERR_HTTP_HEADERS_SENT.
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      if (!res.headersSent) {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;
        res.setHeader(timeoutHeader, `${durationMs.toFixed(2)}ms`);
      }
      return originalWriteHead(...args);
    }) as typeof res.writeHead;

    res.on('finish', () => {
      clearTimeout(timeout);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      if (durationMs > slowThreshold) {
        appLogger.warn(
          {
            method: req.method,
            path: req.path,
            durationMs: durationMs.toFixed(2),
            thresholdMs: slowThreshold,
            correlationId: (req as { correlationId?: string }).correlationId,
          },
          'Slow request detected'
        );
      }
    });

    next();
  };
}

export const requestTimeoutMiddleware = createRequestTimeoutMiddleware({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  perRouteTimeouts: {
    'POST:/api/v1/trades/:id/evidence': 120_000,
    'GET:/api/v1/trades/export': 180_000,
    'POST:/api/v1/trades/export': 180_000,
    'POST:/api/v1/webhooks': 60_000,
  },
  slowRequestThresholdMs: 5_000,
});