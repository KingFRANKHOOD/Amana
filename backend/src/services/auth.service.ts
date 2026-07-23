import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { Request } from 'express';
import { findOrCreateUser } from './user.service';
import { AppError, ErrorCode, isAppError } from '../errors/errorCodes';
import { env } from '../config/env';
import { redis } from '../lib/redis';

const CHALLENGE_PREFIX = 'challenge:';
const REVOKED_PREFIX = 'revoked_jti:';
const CHALLENGE_TTL = 300; // 5 min
// A refresh token can be expired briefly, but it must still be a recently
// issued access token. Keeping these limits here makes the exceptional refresh
// path deliberately narrower than normal JWT validation.
const REFRESH_EXPIRY_GRACE_SECONDS = 15 * 60;
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface JWTPayload {
  sub: string;
  walletAddress: string;
  jti: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  nbf?: number;
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export class AuthService {
  static async generateChallenge(walletAddress: string): Promise<string> {
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid Stellar public key', 400);
    }

    try {
      const challenge = crypto.randomBytes(32).toString('base64url');
      const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}`;

      await redis.set(key, challenge, 'EX', CHALLENGE_TTL);
      return challenge;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Authentication service dependency failure', 503);
    }
  }

  static async verifySignatureAndIssueJWT(walletAddress: string, signedChallenge: string): Promise<string> {
    try {
      const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}`;
      // Atomic get-and-delete prevents replay: a concurrent request that calls
      // getdel after us will receive null even before we finish verification.
      const challenge = await (redis as any).getdel(key);

      if (!challenge) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Challenge expired or invalid. Request new challenge.', 401);
      }

      const publicKey = Keypair.fromPublicKey(walletAddress);
      let isValid = false;
      try {
        isValid = publicKey.verify(
          Buffer.from(challenge, "utf8"),
          Buffer.from(signedChallenge, "base64url"),
        );
      } catch (e) {
        isValid = false;
      }

      if (!isValid) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Invalid signature', 401);
      }

      // Ensure user exists
      await findOrCreateUser(walletAddress);

      return this.issueToken(walletAddress);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Authentication service dependency failure', 503);
    }
  }

  static async validateToken(token: string): Promise<JWTPayload> {
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'JWT_SECRET not set', 500);
    }

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
      }) as JWTPayload;

      if (!decoded.jti) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: missing jti claim', 401);
      }

      if (await this.isTokenRevoked(decoded.jti)) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Unauthorized: token has been revoked', 401);
      }

      return decoded;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token expired', 401);
      }
      // NotBeforeError extends JsonWebTokenError, so this must be checked first
      // to surface a precise "not yet valid" message instead of the generic one.
      if (error instanceof jwt.NotBeforeError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token not yet valid', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Invalid token', 401);
      }
      throw new AppError(ErrorCode.INFRA_ERROR, 'Token validation failed', 500);
    }
  }

  static async refreshToken(oldToken: string): Promise<string> {
    // For refresh, we allow slightly expired tokens if they are otherwise valid
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new AppError(ErrorCode.INFRA_ERROR, 'JWT_SECRET not set', 500);
    }

    try {
      const decoded = jwt.verify(oldToken, secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
        ignoreExpiration: true, // Expiration is checked explicitly against a short grace period below.
      }) as JWTPayload;

      if (
        !decoded.jti ||
        !decoded.walletAddress ||
        typeof decoded.iat !== 'number' ||
        !Number.isFinite(decoded.iat) ||
        typeof decoded.exp !== 'number' ||
        !Number.isFinite(decoded.exp)
      ) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token refresh failed: invalid token claims', 401);
      }

      // A refreshed token must be both recently expired and recently issued.
      // This prevents a valid but arbitrarily old signed token from being used
      // as a renewable credential forever.
      const now = Math.floor(Date.now() / 1000);
      if (now > decoded.exp + REFRESH_EXPIRY_GRACE_SECONDS) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token too old to refresh', 401);
      }
      if (decoded.iat > now + 60 || now - decoded.iat > REFRESH_MAX_AGE_SECONDS) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token too old to refresh', 401);
      }

      if (await this.isTokenRevoked(decoded.jti)) {
        throw new AppError(ErrorCode.AUTH_ERROR, 'Token revoked', 401);
      }

      // Keep the deny-list entry through the refresh grace window as well. An
      // already-expired token otherwise has no remaining normal TTL and could
      // be replayed repeatedly until its grace period ends.
      await this.revokeToken(
        decoded.jti,
        Math.max(decoded.exp, now) + REFRESH_EXPIRY_GRACE_SECONDS,
      );

      return this.issueToken(decoded.walletAddress);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.AUTH_ERROR, 'Token refresh failed', 401);
    }
  }

  /** Add a token's jti to the revocation denylist. TTL matches remaining token lifetime. */
  static async revokeToken(jti: string, expiresAt: number): Promise<void> {
    try {
      if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return;
      const ttl = expiresAt - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return; // already expired — no need to store
      const key = `${REVOKED_PREFIX}${jti}`;
      await redis.set(key, '1', 'EX', ttl);
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation failed', 503);
    }
  }

  /** Returns true if the jti has been revoked. */
  static async isTokenRevoked(jti: string): Promise<boolean> {
    try {
      const key = `${REVOKED_PREFIX}${jti}`;
      return (await redis.exists(key)) === 1;
    } catch (error: unknown) {
      if (isAppError(error)) throw error;
      throw new AppError(ErrorCode.INFRA_ERROR, 'Revocation check failed', 503);
    }
  }


  private static issueToken(walletAddress: string): string {
    const secret = process.env.JWT_SECRET ?? env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not set');
    }

    const ttl = parseInt(process.env.JWT_EXPIRES_IN ?? env.JWT_EXPIRES_IN, 10) || 86400;
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();

    const payload: JWTPayload = {
      sub: walletAddress.toLowerCase(),
      walletAddress: walletAddress.toLowerCase(),
      jti,
      iss: process.env.JWT_ISSUER ?? env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE ?? env.JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + ttl,
    };

    return jwt.sign(payload, secret, { algorithm: 'HS256' });
  }
}
