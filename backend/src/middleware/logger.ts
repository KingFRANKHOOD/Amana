import pinoHttp from 'pino-http';
import pino from 'pino';
import type { Request } from 'express';
import { env } from '../config/env';

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
  autoLogging: {
    ignore: (req) => {
      const url = (req as any).url ?? '';
      return !!url.match(/^\/health/) || !!url.match(/^\/api\/docs/);
    },
  },
});

