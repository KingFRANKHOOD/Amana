import { Request, Response } from 'express';
import { ErrorCode } from '../errors/errorCodes';
import { RATE_LIMIT_CONFIG } from '../config/rateLimit';

const mockRateLimit = jest.fn((options: unknown) => {
  void options;
  return (_req: Request, _res: Response, next: () => void) => next();
});

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
    const options = mockRateLimit.mock.calls[0][0] as any;

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

    const options = mockRateLimit.mock.calls[0][0] as any;
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

    const options = mockRateLimit.mock.calls[0][0] as any;
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

    const options = mockRateLimit.mock.calls[0][0] as any;
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
    expect((mockRateLimit.mock.calls[0][0] as any).max).toBe(RATE_LIMIT_CONFIG.auth.max);
    expect((mockRateLimit.mock.calls[1][0] as any).max).toBe(RATE_LIMIT_CONFIG.authRefresh.max);
  });
});
