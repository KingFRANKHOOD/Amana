import pinoHttp from 'pino-http';
import pino from 'pino';
import { env } from '../config/env';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

export default pinoHttp({
  logger,
  serializers: pinoHttp.stdSerializers,
  autoLogging: {
    ignore: (req) => req.path.match(/^\/health/) || req.path.match(/^\/api\/docs/),
  },
});

