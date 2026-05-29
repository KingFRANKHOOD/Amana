import rateLimit from 'express-rate-limit';
import { NextFunction, Request, Response } from 'express';
import { RateLimitPreset } from '../config/rateLimit';
import { ErrorCode } from '../errors/errorCodes';
import { AuthRequest } from '../services/auth.service';

type KeyGenerator = (req: Request) => string;

function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function resolveWalletAddress(req: Request): string | undefined {
  const walletAddress = (req as AuthRequest).user?.walletAddress?.trim();
  return walletAddress || undefined;
}

export function createIpRateLimiter(preset: RateLimitPreset) {
  return createRateLimiter(preset, resolveClientIp);
}

export function createWalletRateLimiter(preset: RateLimitPreset) {
  return createRateLimiter(preset, (req: Request) => {
    const walletAddress = resolveWalletAddress(req);
    if (!walletAddress) {
      return resolveClientIp(req);
    }
    return `wallet:${walletAddress}`;
  });
}

function createRateLimiter(preset: RateLimitPreset, keyGenerator: KeyGenerator) {
  return rateLimit({
    windowMs: preset.windowMs,
    max: preset.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: preset.message,
    keyGenerator,
    handler: (
      req: Request,
      res: Response,
      _next: NextFunction,
      options: { message?: string | unknown; windowMs?: number; max?: number },
    ) => {
      const retryAfterSeconds = Math.ceil((options.windowMs ?? preset.windowMs) / 1000);

      res.status(429).json({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: typeof options.message === 'string' ? options.message : preset.message,
        details: {
          retryAfterSeconds,
          limit: options.max ?? preset.max,
          windowMs: options.windowMs ?? preset.windowMs,
        },
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    },
  });
}
