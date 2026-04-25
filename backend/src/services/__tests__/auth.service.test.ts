import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';
import { AppError, ErrorCode } from '../../errors/errorCodes';

jest.mock('ioredis', () => {
  const m = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };
  const ctor = jest.fn().mockImplementation(() => m);
  (ctor as any)._instance = m;
  return ctor;
});

jest.mock('../user.service', () => ({
  findOrCreateUser: jest.fn(),
}));

const { AuthService } = require('../auth.service');
import { JWTPayload } from '../auth.service';
import { findOrCreateUser } from '../user.service';

describe('AuthService', () => {
  let realWallet: string;
  let keypair: Keypair;
  const getRedisMock = () => (Redis as any)._instance;

  beforeAll(() => {
    keypair = Keypair.random();
    realWallet = keypair.publicKey();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_ISSUER = 'amana';
    process.env.JWT_AUDIENCE = 'amana-api';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const redisMock = getRedisMock();
    redisMock.get.mockReset();
    redisMock.set.mockReset();
    redisMock.del.mockReset();
    redisMock.exists.mockReset();
    (findOrCreateUser as jest.Mock).mockReset();
  });

  describe('generateChallenge', () => {
    it('should generate a challenge and store it in Redis', async () => {
      const redisMock = getRedisMock();
      redisMock.set.mockResolvedValue('OK');

      const challenge = await AuthService.generateChallenge(realWallet);

      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe('string');
      expect(redisMock.set).toHaveBeenCalledWith(
        expect.stringContaining(realWallet.toLowerCase()),
        challenge,
        'EX',
        300
      );
    });

    it('should throw validation error for invalid public key', async () => {
      await expect(AuthService.generateChallenge('invalid-key')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      });
    });

    it('should throw infra error if Redis fails', async () => {
      const redisMock = getRedisMock();
      redisMock.set.mockRejectedValue(new Error('Redis down'));

      await expect(AuthService.generateChallenge(realWallet)).rejects.toMatchObject({
        code: ErrorCode.INFRA_ERROR
      });
    });
  });

  describe('verifySignatureAndIssueJWT', () => {
    it('should verify signature and issue a JWT', async () => {
      const challenge = 'test-challenge';
      const redisMock = getRedisMock();
      redisMock.get.mockResolvedValue(challenge);
      redisMock.del.mockResolvedValue(1);
      (findOrCreateUser as jest.Mock).mockResolvedValue({ id: 'user-1' });

      const signedChallenge = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64url');
      const token = await AuthService.verifySignatureAndIssueJWT(realWallet, signedChallenge);

      expect(token).toBeDefined();
      expect(redisMock.get).toHaveBeenCalled();
      expect(redisMock.del).toHaveBeenCalled();
      expect(findOrCreateUser).toHaveBeenCalledWith(realWallet);
      
      const decoded = jwt.verify(token, 'test-secret') as JWTPayload;
      expect(decoded.sub).toBe(realWallet.toLowerCase());
    });

    it('should throw auth error if challenge not found', async () => {
      const redisMock = getRedisMock();
      redisMock.get.mockResolvedValue(null);

      await expect(AuthService.verifySignatureAndIssueJWT(realWallet, 'sig')).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });
    });

    it('should throw auth error if signature is invalid', async () => {
      const challenge = 'test-challenge';
      const redisMock = getRedisMock();
      redisMock.get.mockResolvedValue(challenge);

      const invalidSignature = Buffer.from('invalid').toString('base64url');
      await expect(AuthService.verifySignatureAndIssueJWT(realWallet, invalidSignature)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });
    });

    it('burns the challenge after a failed signature attempt to block replay guessing', async () => {
      const challenge = 'test-challenge';
      const redisMock = getRedisMock();
      redisMock.get.mockResolvedValueOnce(challenge).mockResolvedValueOnce(null);
      redisMock.del.mockResolvedValue(1);

      const invalidSignature = Buffer.from('invalid').toString('base64url');
      await expect(AuthService.verifySignatureAndIssueJWT(realWallet, invalidSignature)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });

      const validSignature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64url');
      await expect(AuthService.verifySignatureAndIssueJWT(realWallet, validSignature)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });
      expect(redisMock.del).toHaveBeenCalledTimes(1);
      expect(findOrCreateUser).not.toHaveBeenCalled();
    });

    it('rejects nonce reuse after a successful verification', async () => {
      const challenge = 'single-use-challenge';
      const redisMock = getRedisMock();
      redisMock.get.mockResolvedValueOnce(challenge).mockResolvedValueOnce(null);
      redisMock.del.mockResolvedValue(1);
      redisMock.exists.mockResolvedValue(0);
      (findOrCreateUser as jest.Mock).mockResolvedValue({ id: 'user-1' });

      const signedChallenge = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64url');
      const token = await AuthService.verifySignatureAndIssueJWT(realWallet, signedChallenge);
      expect(token).toBeDefined();

      await expect(AuthService.verifySignatureAndIssueJWT(realWallet, signedChallenge)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });
      expect(findOrCreateUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateToken', () => {
    it('should validate a correct token', async () => {
      const payload = {
        sub: realWallet.toLowerCase(),
        walletAddress: realWallet.toLowerCase(),
        jti: 'test-jti',
        iss: 'amana',
        aud: 'amana-api',
      };
      const token = jwt.sign(payload, 'test-secret');
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      const decoded = await AuthService.validateToken(token);
      expect(decoded.jti).toBe('test-jti');
    });

    it('should throw auth error for expired token', async () => {
      const payload = { jti: 'test-jti', exp: Math.floor(Date.now() / 1000) - 10 };
      const token = jwt.sign(payload, 'test-secret');

      await expect(AuthService.validateToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: 'Token expired'
      });
    });

    it('should throw auth error for revoked token', async () => {
      const payload = { jti: 'revoked-jti', sub: 'user', walletAddress: 'addr', iss: 'amana', aud: 'amana-api' };
      const token = jwt.sign(payload, 'test-secret');
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(1);

      await expect(AuthService.validateToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: expect.stringMatching(/revoked/)
      });
    });

    it('should throw auth error if jti is missing', async () => {
      const payload = { sub: 'user', walletAddress: 'addr', iss: 'amana', aud: 'amana-api' };
      const token = jwt.sign(payload, 'test-secret');
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      await expect(AuthService.validateToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: expect.stringMatching(/missing jti/)
      });
    });

    it('rejects JWTs signed with an unexpected algorithm', async () => {
      const payload = {
        sub: realWallet.toLowerCase(),
        walletAddress: realWallet.toLowerCase(),
        jti: 'bad-alg-jti',
        iss: 'amana',
        aud: 'amana-api',
      };
      const token = jwt.sign(payload, 'test-secret', { algorithm: 'HS384' });
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      await expect(AuthService.validateToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: 'Invalid token'
      });
    });

    it('rejects JWTs minted for another audience', async () => {
      const payload = {
        sub: realWallet.toLowerCase(),
        walletAddress: realWallet.toLowerCase(),
        jti: 'wrong-audience-jti',
        iss: 'amana',
        aud: 'other-api',
      };
      const token = jwt.sign(payload, 'test-secret');
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      await expect(AuthService.validateToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: 'Invalid token'
      });
    });
  });

  describe('refreshToken', () => {
    it('should issue a new token and revoke the old one', async () => {
      const oldJti = 'old-jti';
      const payload = { 
        sub: realWallet.toLowerCase(), 
        walletAddress: realWallet.toLowerCase(), 
        jti: oldJti,
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const oldToken = jwt.sign(payload, 'test-secret');
      
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);
      redisMock.set.mockResolvedValue('OK');

      const newToken = await AuthService.refreshToken(oldToken);

      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(oldToken);
    });

    it('should allow refresh of recently expired token', async () => {
      const oldJti = 'expired-jti';
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const payload = { 
        sub: realWallet.toLowerCase(), 
        walletAddress: realWallet.toLowerCase(), 
        jti: oldJti,
        exp: exp
      };
      const oldToken = jwt.sign(payload, 'test-secret');
      
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      const newToken = await AuthService.refreshToken(oldToken);
      expect(newToken).toBeDefined();
    });

    it('should throw auth error if token is too old', async () => {
      const oldJti = 'very-old-jti';
      const exp = Math.floor(Date.now() / 1000) - (8 * 24 * 3600);
      const payload = { 
        sub: realWallet.toLowerCase(), 
        walletAddress: realWallet.toLowerCase(), 
        jti: oldJti,
        exp: exp
      };
      const oldToken = jwt.sign(payload, 'test-secret');
      
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      await expect(AuthService.refreshToken(oldToken)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        message: expect.stringMatching(/too old/)
      });
    });

    it('should throw auth error if token is revoked', async () => {
      const payload = { jti: 'revoked-jti', sub: 'user', walletAddress: 'addr' };
      const token = jwt.sign(payload, 'test-secret');
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(1);

      await expect(AuthService.refreshToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR
      });
    });

    it('rejects refresh tokens missing jti or walletAddress claims', async () => {
      const token = jwt.sign(
        {
          sub: realWallet.toLowerCase(),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'test-secret'
      );
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(0);

      await expect(AuthService.refreshToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401
      });
      expect(redisMock.exists).not.toHaveBeenCalled();
    });
  });

  describe('revokeToken and isTokenRevoked', () => {
    it('should set revocation in Redis', async () => {
      const redisMock = getRedisMock();
      redisMock.set.mockResolvedValue('OK');
      
      await AuthService.revokeToken('jti-1', Math.floor(Date.now() / 1000) + 100);

      expect(redisMock.set).toHaveBeenCalledWith(
        expect.stringContaining('jti-1'),
        '1',
        'EX',
        expect.any(Number)
      );
    });

    it('should return true if token is revoked', async () => {
      const redisMock = getRedisMock();
      redisMock.exists.mockResolvedValue(1);
      expect(await AuthService.isTokenRevoked('jti-1')).toBe(true);
    });
  });
});
