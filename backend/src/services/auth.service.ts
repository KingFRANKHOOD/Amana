import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
// AuthPayload defined inline
import { findOrCreateUser } from './user.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);
const CHALLENGE_PREFIX = 'challenge:';
const REVOKED_PREFIX = 'revoked_jti:';
const CHALLENGE_TTL = 300; // 5 min

export class AuthService {
  static async generateChallenge(walletAddress: string): Promise<string> {
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new Error('Invalid Stellar public key');
    }

    const challenge = crypto.randomBytes(32).toString('base64url');
    const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}`;

    await redis.set(key, challenge, 'EX', CHALLENGE_TTL);
    return challenge;
  }

  static async verifySignatureAndIssueJWT(walletAddress: string, signedChallenge: string): Promise<string> {
    const key = `${CHALLENGE_PREFIX}${walletAddress.toLowerCase()}`;
    const challenge = await redis.get(key);

    if (!challenge) {
      throw new Error('Challenge expired or invalid. Request new challenge.');
    }

    // Replay protection: delete immediately after fetch
    await redis.del(key);

    const publicKey = Keypair.fromPublicKey(walletAddress);
    const isValid = publicKey.verify(
      Buffer.from(challenge, "utf8"),
      Buffer.from(signedChallenge, "base64url"),
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Ensure user exists
    await findOrCreateUser(walletAddress);

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not set');
    }

    const ttl = parseInt(process.env.JWT_EXPIRES_IN || '86400') || 86400;
    const now = Math.floor(Date.now() / 1000);
    const jti = crypto.randomUUID();

    const payload = {
      sub: walletAddress.toLowerCase(),
      walletAddress: walletAddress.toLowerCase(),
      jti,
      iss: process.env.JWT_ISSUER || 'amana',
      aud: process.env.JWT_AUDIENCE || 'amana-api',
      iat: now,
      nbf: now,
      exp: now + ttl,
    };

    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
    return token;
  }

  /** Add a token's jti to the revocation denylist. TTL matches remaining token lifetime. */
  static async revokeToken(jti: string, expiresAt: number): Promise<void> {
    const ttl = expiresAt - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired — no need to store
    const key = `${REVOKED_PREFIX}${jti}`;
    await redis.set(key, '1', 'EX', ttl);
  }

  /** Returns true if the jti has been revoked. */
  static async isTokenRevoked(jti: string): Promise<boolean> {
    const key = `${REVOKED_PREFIX}${jti}`;
    return (await redis.exists(key)) === 1;
  }
}

