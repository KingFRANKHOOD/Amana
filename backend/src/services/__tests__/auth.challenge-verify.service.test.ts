import { ErrorCode } from '../../errors/errorCodes';
import { findOrCreateUser } from '../user.service';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
};

const mockJwtSign: jest.Mock = jest.fn();
const mockVerifySignature: jest.Mock = jest.fn();
const mockFromPublicKey: jest.Mock = jest.fn(() => ({
  verify: mockVerifySignature,
}));
const mockIsValidEd25519PublicKey: jest.Mock = jest.fn();

class MockTokenExpiredError extends Error {}
class MockJsonWebTokenError extends Error {}

jest.mock(
  'ioredis',
  () => jest.fn().mockImplementation(() => mockRedis),
  { virtual: true },
);

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: (...args: any[]) => mockJwtSign(...args),
    verify: jest.fn(),
    TokenExpiredError: MockTokenExpiredError,
    JsonWebTokenError: MockJsonWebTokenError,
  },
}));

jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: (walletAddress: string) => mockFromPublicKey(walletAddress),
  },
  StrKey: {
    isValidEd25519PublicKey: (walletAddress: string) => mockIsValidEd25519PublicKey(walletAddress),
  },
}));

jest.mock('../user.service', () => ({
  findOrCreateUser: jest.fn(),
}));

const { AuthService } = require('../auth.service');

describe('AuthService challenge/verify flow', () => {
  const walletAddress = 'GBZXN7PIRZGNMHGA2Z7WQ3I5VL7QJ5Y5G5WMU4KJZ5R2LQ4ZV7K6ZJGN';
  const challengeKey = `challenge:${walletAddress.toLowerCase()}`;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    process.env.JWT_SECRET = 'jwt-secret';
    process.env.JWT_ISSUER = 'amana';
    process.env.JWT_AUDIENCE = 'amana-api';
    process.env.JWT_EXPIRES_IN = '86400';

    mockIsValidEd25519PublicKey.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.exists.mockResolvedValue(0);
    mockVerifySignature.mockReturnValue(true);
    mockJwtSign.mockReturnValue('signed.jwt.token');
    (findOrCreateUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
  });

  it('creates unique challenges, stores them in Redis, and applies a 5 minute TTL', async () => {
    const firstChallenge = await AuthService.generateChallenge(walletAddress);
    const secondChallenge = await AuthService.generateChallenge(walletAddress);

    expect(firstChallenge).not.toBe(secondChallenge);
    expect(mockRedis.set).toHaveBeenNthCalledWith(1, challengeKey, firstChallenge, 'EX', 300);
    expect(mockRedis.set).toHaveBeenNthCalledWith(2, challengeKey, secondChallenge, 'EX', 300);
  });

  it('rejects invalid Stellar addresses before touching Redis', async () => {
    mockIsValidEd25519PublicKey.mockReturnValue(false);

    await expect(AuthService.generateChallenge('invalid-address')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: 400,
    });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns an infra error when challenge storage fails', async () => {
    mockRedis.set.mockRejectedValue(new Error('redis unavailable'));

    await expect(AuthService.generateChallenge(walletAddress)).rejects.toMatchObject({
      code: ErrorCode.INFRA_ERROR,
      statusCode: 503,
    });
  });

  it('verifies the signature, deletes the challenge, and signs an HS256 JWT with the expected claims', async () => {
    const issuedAtMs = 1_710_000_000_000;
    mockRedis.get.mockResolvedValue('challenge-value');
    jest.spyOn(Date, 'now').mockReturnValue(issuedAtMs);
    jest.spyOn(require('crypto'), 'randomUUID').mockReturnValue('123e4567-e89b-12d3-a456-426614174000');

    const token = await AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmVkLWNoYWxsZW5nZQ');

    expect(token).toBe('signed.jwt.token');
    expect(mockRedis.get).toHaveBeenCalledWith(challengeKey);
    expect(mockRedis.del).toHaveBeenCalledWith(challengeKey);
    expect(mockFromPublicKey).toHaveBeenCalledWith(walletAddress);
    expect(mockVerifySignature).toHaveBeenCalledWith(
      Buffer.from('challenge-value', 'utf8'),
      Buffer.from('c2lnbmVkLWNoYWxsZW5nZQ', 'base64url'),
    );
    expect(findOrCreateUser).toHaveBeenCalledWith(walletAddress);

    const issuedAt = Math.floor(issuedAtMs / 1000);
    expect(mockJwtSign).toHaveBeenCalledWith(
      {
        sub: walletAddress.toLowerCase(),
        walletAddress: walletAddress.toLowerCase(),
        jti: '123e4567-e89b-12d3-a456-426614174000',
        iss: 'amana',
        aud: 'amana-api',
        iat: issuedAt,
        nbf: issuedAt,
        exp: issuedAt + 86_400,
      },
      'jwt-secret',
      { algorithm: 'HS256' },
    );
  });

  it('rejects expired or missing challenges', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmF0dXJl'),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_ERROR,
      statusCode: 401,
    });
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(mockJwtSign).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures and burns the challenge to block replay attempts', async () => {
    mockRedis.get.mockResolvedValue('challenge-value');
    mockVerifySignature.mockReturnValue(false);

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'YmFkLXNpZ25hdHVyZQ'),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_ERROR,
      statusCode: 401,
    });
    expect(mockRedis.del).toHaveBeenCalledWith(challengeKey);
    expect(findOrCreateUser).not.toHaveBeenCalled();
    expect(mockJwtSign).not.toHaveBeenCalled();
  });

  it('prevents replay by deleting a challenge after a successful verification', async () => {
    mockRedis.get
      .mockResolvedValueOnce('challenge-value')
      .mockResolvedValueOnce(null);

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmF0dXJl'),
    ).resolves.toBe('signed.jwt.token');

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmF0dXJl'),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTH_ERROR,
      statusCode: 401,
    });

    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockJwtSign).toHaveBeenCalledTimes(1);
  });

  it('surfaces Redis/network failures from challenge lookup as infra errors', async () => {
    mockRedis.get.mockRejectedValue(new Error('network timeout'));

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmF0dXJl'),
    ).rejects.toMatchObject({
      code: ErrorCode.INFRA_ERROR,
      statusCode: 503,
    });
  });

  it('surfaces downstream user creation failures as infra errors', async () => {
    mockRedis.get.mockResolvedValue('challenge-value');
    (findOrCreateUser as jest.Mock).mockRejectedValue(new Error('database unavailable'));

    await expect(
      AuthService.verifySignatureAndIssueJWT(walletAddress, 'c2lnbmF0dXJl'),
    ).rejects.toMatchObject({
      code: ErrorCode.INFRA_ERROR,
      statusCode: 503,
    });

    expect(mockRedis.del).toHaveBeenCalledWith(challengeKey);
    expect(mockJwtSign).not.toHaveBeenCalled();
  });
});
