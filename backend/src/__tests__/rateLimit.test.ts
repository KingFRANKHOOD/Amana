import { Request, Response } from 'express';
import { ErrorCode } from '../errors/errorCodes';
import { RATE_LIMIT_CONFIG } from '../config/rateLimit';

const mockRateLimit = jest.fn((options: unknown) => {
  void options;
  return (_req: Request, _res: Response, next: () => void) => next();
});

type RateLimiterOptions = {
  windowMs: number;
  max: number;
  standardHeaders: boolean;
  legacyHeaders: boolean;
  handler: (
    req: Request,
    res: Response,
    next: () => void,
    options: { message?: string; windowMs?: number; max?: number },
  ) => void;
  keyGenerator: (req: Request) => string;
};

function firstRateLimitOptions(): RateLimiterOptions {
  const call = mockRateLimit.mock.calls[0];
  expect(call).toBeDefined();
  return call![0] as RateLimiterOptions;
}

jest.mock('express-rate-limit', () => ({
  __esModule: true,
  default: (options: unknown) => mockRateLimit(options),
}));

describe('rate limit configuration', () => {
  it('defines auth limits for challenge and verify endpoints', () => {
    expect(RATE_LIMIT_CONFIG.auth).toEqual({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many challenges/verify attempts, try again later.',
    });
  });

  it('defines refresh limits separately from challenge/verify', () => {
    expect(RATE_LIMIT_CONFIG.authRefresh.max).toBeGreaterThan(RATE_LIMIT_CONFIG.auth.max);
    expect(RATE_LIMIT_CONFIG.authRefresh.windowMs).toBe(15 * 60 * 1000);
  });

  it('defines user profile limits', () => {
    expect(RATE_LIMIT_CONFIG.user).toEqual({
      windowMs: 60 * 1000,
      max: 30,
      message: 'Too many user profile requests, try again later.',
    });
  });

  it('defines wallet-scoped dispute initiation limits', () => {
    expect(RATE_LIMIT_CONFIG.dispute).toEqual({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: 'Too many dispute initiation attempts, try again later.',
    });
  });

  it('honors environment overrides when the rate limit config is loaded', () => {
    const previousMax = process.env.RATE_LIMIT_AUTH_MAX;
    const previousWindow = process.env.RATE_LIMIT_AUTH_WINDOW_MS;
    process.env.RATE_LIMIT_AUTH_MAX = '3';
    process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';

    try {
      jest.isolateModules(() => {
        const { RATE_LIMIT_CONFIG: reloadedConfig } = require('../config/rateLimit') as typeof import('../config/rateLimit');
        expect(reloadedConfig.auth.max).toBe(3);
        expect(reloadedConfig.auth.windowMs).toBe(60_000);
      });
    } finally {
      if (previousMax === undefined) {
        delete process.env.RATE_LIMIT_AUTH_MAX;
      } else {
        process.env.RATE_LIMIT_AUTH_MAX = previousMax;
      }
      if (previousWindow === undefined) {
        delete process.env.RATE_LIMIT_AUTH_WINDOW_MS;
      } else {
        process.env.RATE_LIMIT_AUTH_WINDOW_MS = previousWindow;
      }
    }
  });
});

describe('rate limit factory', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRateLimit.mockClear();
  });

  it('creates IP-based limiters with standard headers and structured 429 responses', () => {
    jest.isolateModules(() => {
      const { createIpRateLimiter } = require('../lib/rateLimit');
      createIpRateLimiter(RATE_LIMIT_CONFIG.auth);
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    const options = firstRateLimitOptions();

    expect(options.windowMs).toBe(RATE_LIMIT_CONFIG.auth.windowMs);
    expect(options.max).toBe(RATE_LIMIT_CONFIG.auth.max);
    expect(options.standardHeaders).toBe(true);
    expect(options.legacyHeaders).toBe(false);

    const req = {
      path: '/auth/challenge',
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    options.handler(req, res, jest.fn(), {
      message: RATE_LIMIT_CONFIG.auth.message,
      windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
      max: RATE_LIMIT_CONFIG.auth.max,
    });

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: RATE_LIMIT_CONFIG.auth.message,
        details: expect.objectContaining({
          retryAfterSeconds: 900,
          limit: 10,
          windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
        }),
        path: '/auth/challenge',
      }),
    );
  });

  it('keys IP limiters by the first x-forwarded-for address when present', () => {
    jest.isolateModules(() => {
      const { createIpRateLimiter } = require('../lib/rateLimit');
      createIpRateLimiter(RATE_LIMIT_CONFIG.user);
    });

    const options = firstRateLimitOptions();
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    expect(options.keyGenerator(req)).toBe('203.0.113.10');
  });

  it('keys wallet limiters by authenticated wallet address', () => {
    jest.isolateModules(() => {
      const { createWalletRateLimiter } = require('../lib/rateLimit');
      createWalletRateLimiter(RATE_LIMIT_CONFIG.dispute);
    });

    const options = firstRateLimitOptions();
    const req = {
      user: { walletAddress: 'GABC123EXAMPLEKEYEXAMPLEKEYEXAMPLEKEYEXAMPLE12' },
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    expect(options.keyGenerator(req)).toBe(
      'wallet:GABC123EXAMPLEKEYEXAMPLEKEYEXAMPLEKEYEXAMPLE12',
    );
  });

  it('falls back to client IP when wallet limiter runs without auth context', () => {
    jest.isolateModules(() => {
      const { createWalletRateLimiter } = require('../lib/rateLimit');
      createWalletRateLimiter(RATE_LIMIT_CONFIG.dispute);
    });

    const options = firstRateLimitOptions();
    const req = {
      headers: {},
      ip: '198.51.100.4',
      socket: { remoteAddress: '198.51.100.4' },
    } as unknown as Request;

    expect(options.keyGenerator(req)).toBe('198.51.100.4');
  });
});

describe('auth route wiring', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRateLimit.mockClear();
  });

  it('registers separate auth and refresh limiters', () => {
    jest.mock('../services/auth.service', () => ({
      AuthService: {
        generateChallenge: jest.fn(),
        verifySignatureAndIssueJWT: jest.fn(),
        refreshToken: jest.fn(),
        revokeToken: jest.fn(),
      },
    }));
    jest.mock('../middleware/auth.middleware', () => ({
      authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    }));

    jest.isolateModules(() => {
      require('../routes/auth.routes');
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    const [authCall, refreshCall] = mockRateLimit.mock.calls;
    expect(authCall).toBeDefined();
    expect(refreshCall).toBeDefined();
    expect((authCall![0] as RateLimiterOptions).max).toBe(RATE_LIMIT_CONFIG.auth.max);
    expect((refreshCall![0] as RateLimiterOptions).max).toBe(RATE_LIMIT_CONFIG.authRefresh.max);
  });
});

describe('breach tracker bounds (issue #1206)', () => {
  type RateLimitModule = typeof import('../lib/rateLimit');

  let rateLimitModule: RateLimitModule;
  let handler: RateLimiterOptions['handler'];

  const createRes = () =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  const breachFrom = (ip: string) => {
    const req = {
      headers: {},
      ip,
      socket: { remoteAddress: ip },
      path: '/auth/challenge',
      method: 'POST',
    } as unknown as Request;
    handler(req, createRes(), jest.fn(), { windowMs: 60_000, max: 1 });
  };

  beforeEach(() => {
    jest.resetModules();
    mockRateLimit.mockClear();
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });

    jest.isolateModules(() => {
      const { appLogger } = require('../middleware/logger');
      jest.spyOn(appLogger, 'info').mockImplementation(() => undefined);
      jest.spyOn(appLogger, 'warn').mockImplementation(() => undefined);
      rateLimitModule = require('../lib/rateLimit');
    });

    rateLimitModule.resetBreachTracker();
    rateLimitModule.createIpRateLimiter({ windowMs: 60_000, max: 1, message: 'slow down' });
    handler = firstRateLimitOptions().handler;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('caps the number of tracked keys under high unique-IP load', () => {
    const max = rateLimitModule.BREACH_TRACKER_MAX_ENTRIES;
    for (let i = 0; i < max + 500; i++) {
      breachFrom(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }

    expect(rateLimitModule.getBreachTrackerSize()).toBeLessThanOrEqual(max);
  });

  it('evicts entries whose breach window has expired', () => {
    for (let i = 0; i < 100; i++) {
      breachFrom(`192.0.2.${i}`);
    }
    expect(rateLimitModule.getBreachTrackerSize()).toBe(100);

    jest.setSystemTime(new Date('2026-01-01T00:16:00Z'));
    breachFrom('198.51.100.1');

    expect(rateLimitModule.getBreachTrackerSize()).toBe(1);
  });

  it('keeps counting repeated breaches from the same key within the window', () => {
    for (let i = 0; i < 5; i++) {
      breachFrom('203.0.113.7');
    }

    expect(rateLimitModule.getBreachTrackerSize()).toBe(1);
  });
});
