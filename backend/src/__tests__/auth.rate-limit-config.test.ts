const mockCreateIpRateLimiter: jest.Mock = jest.fn((_preset: unknown) => (_req: any, _res: any, next: any) => next());

jest.mock('../config/rateLimit', () => ({
  RATE_LIMIT_CONFIG: {
    auth: {
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many challenges/verify attempts, try again later.',
    },
    authRefresh: {
      windowMs: 15 * 60 * 1000,
      max: 30,
      message: 'Too many token refresh attempts, try again later.',
    },
  },
}));

jest.mock('../lib/rateLimit', () => ({
  createIpRateLimiter: (preset: unknown) => mockCreateIpRateLimiter(preset),
}));

jest.mock(
  'zod',
  () => ({
    z: {
      object: () => ({
        parse: (value: any) => value,
      }),
      string: () => ({
        refine: () => ({}),
      }),
    },
  }),
  { virtual: true },
);

jest.mock('../services/auth.service', () => ({
  AuthService: {
    generateChallenge: jest.fn(),
    verifySignatureAndIssueJWT: jest.fn(),
    refreshToken: jest.fn(),
    revokeToken: jest.fn(),
  },
}));

jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

describe('auth route rate limiting', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateIpRateLimiter.mockClear();
  });

  it('wires shared auth and refresh limiters from centralized presets', () => {
    jest.isolateModules(() => {
      require('../routes/auth.routes');
    });

    expect(mockCreateIpRateLimiter).toHaveBeenCalledTimes(2);
    expect(mockCreateIpRateLimiter).toHaveBeenNthCalledWith(1, expect.objectContaining({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many challenges/verify attempts, try again later.',
    }));
    expect(mockCreateIpRateLimiter).toHaveBeenNthCalledWith(2, expect.objectContaining({
      windowMs: 15 * 60 * 1000,
      max: 30,
      message: 'Too many token refresh attempts, try again later.',
    }));
  });
});
