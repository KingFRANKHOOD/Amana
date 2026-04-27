const mockRateLimit: jest.Mock = jest.fn(() => (_req: any, _res: any, next: any) => next());

jest.mock(
  'express-rate-limit',
  () => ({
    __esModule: true,
    default: (options: any) => mockRateLimit(options),
  }),
  { virtual: true },
);

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
    mockRateLimit.mockClear();
  });

  it('configures the auth limiter for 10 requests per 15 minute window', () => {
    jest.isolateModules(() => {
      require('../routes/auth.routes');
    });

    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many challenges/verify attempts, try again later.',
    });
  });
});
