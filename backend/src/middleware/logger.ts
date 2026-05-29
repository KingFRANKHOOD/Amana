import pinoHttp from 'pino-http';
import pino from 'pino';
import type { Request } from 'express';
import { env } from '../config/env';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './correlationId.middleware';

const isTest = env.NODE_ENV === 'test';

export const appLogger = pino(
  isTest
    ? { level: 'silent' }
    : {
        level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      },
);

export default pinoHttp({
  logger: appLogger,
  // Attach correlation/request IDs to every log record produced by pino-http.
  customProps: (req) => ({
    correlationId: (req as any).correlationId,
    requestId: (req as any).requestId,
  }),
  // Expose the IDs in the response log as well.
  customSuccessMessage: (req, res) =>
    `${req.method} ${(req as any).url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${(req as any).url} ${res.statusCode} – ${err.message}`,
  autoLogging: {
    ignore: (req) => {
      const url = (req as any).url ?? '';
      return !!url.match(/^\/health/) || !!url.match(/^\/api\/docs/);
    },
  },
  // Include correlation/request IDs in the serialised request object.
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        [CORRELATION_ID_HEADER]: req.raw?.correlationId,
        [REQUEST_ID_HEADER]: req.raw?.requestId,
      };
    },
  },
});
