import rateLimit, { Options } from 'express-rate-limit';
import { NextFunction, Request, Response } from 'express';
import { RateLimitPreset } from '../config/rateLimit';
import { ErrorCode } from '../errors/errorCodes';
import { AuthRequest } from '../services/auth.service';
import { appLogger } from '../middleware/logger';
import { env } from '../config/env';

// A single IPv4/IPv6 address, optionally with a zone id (e.g. fe80::1%eth0).
const IP_ADDRESS_PATTERN = /^[a-fA-F0-9:.]+(%[a-zA-Z0-9]+)?$/;

type KeyGenerator = (req: Request) => string;

// Track rate limit breach attempts for suspicious activity detection
const breachTracker = new Map<string, { count: number; firstBreach: Date; lastBreach: Date }>();
const BREACH_ALERT_THRESHOLD = 5; // Alert after 5 breaches
const BREACH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window

function trackRateLimitBreach(key: string, req: Request): void {
  const now = new Date();
  const existing = breachTracker.get(key);

  if (existing) {
    // Check if still within the window
    if (now.getTime() - existing.firstBreach.getTime() < BREACH_WINDOW_MS) {
      existing.count++;
      existing.lastBreach = now;

      // Alert on suspicious patterns
      if (existing.count >= BREACH_ALERT_THRESHOLD) {
        appLogger.warn({
          key,
          breachCount: existing.count,
          firstBreach: existing.firstBreach.toISOString(),
          lastBreach: existing.lastBreach.toISOString(),
          ip: resolveClientIp(req),
          path: req.path,
          userAgent: req.headers['user-agent'],
          walletAddress: resolveWalletAddress(req),
          alert: 'RATE_LIMIT_ABUSE',
        }, 'Suspicious rate-limit breach pattern detected');
      }
    } else {
      // Reset if outside window
      breachTracker.set(key, { count: 1, firstBreach: now, lastBreach: now });
    }
  } else {
    breachTracker.set(key, { count: 1, firstBreach: now, lastBreach: now });
  }

  // Log every breach for audit trail
  appLogger.info({
    key,
    ip: resolveClientIp(req),
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
    walletAddress: resolveWalletAddress(req),
  }, 'Rate limit breach');
}

function resolveClientIp(req: Request): string {
  // X-Forwarded-For is only trustworthy when we sit behind a known proxy
  // (e.g. a load balancer) that overwrites/sets it itself. Otherwise any
  // client can spoof it to rotate their rate-limit key.
  if (env.TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : '';
    if (candidate && IP_ADDRESS_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return req.socket?.remoteAddress || req.ip || 'unknown';
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
      options: Options,
    ) => {
      const retryAfterSeconds = Math.ceil((options.windowMs ?? preset.windowMs) / 1000);
      const key = keyGenerator(req);

      // Track and alert on suspicious breach patterns
      trackRateLimitBreach(key, req);

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
