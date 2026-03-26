import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
// AuthPayload defined inline
import { findOrCreateUser } from './user.service';
import { supabase } from '../lib/supabase';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);
const CHALLENGE_PREFIX = 'challenge:';
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
    const isValid = publicKey.verify(challenge, signedChallenge);

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Ensure user exists
    await findOrCreateUser(walletAddress);

const payload = {
      walletAddress: walletAddress.toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (parseInt(process.env.JWT_EXPIRES_IN || '86400') || 86400),
    };

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not set');
    }

    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
    return token;
  }
}

