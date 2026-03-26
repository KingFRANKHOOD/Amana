import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = (err as any).status || 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  res.status(status).json({
    error: true,
    status,
    message,
  });
}

