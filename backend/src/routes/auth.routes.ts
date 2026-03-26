import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { AuthService } from '../services/auth.service';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many challenges/verify attempts, try again later.',
});

const router = Router();

const challengeSchema = z.object({
  walletAddress: z.string().refine((val) => StrKey.isValidEd25519PublicKey(val), {
    message: 'Invalid Stellar public key',
  }),
});

router.post('/challenge', limiter, async (req, res) => {
  try {
    const { walletAddress } = challengeSchema.parse(req.body);
    const challenge = await AuthService.generateChallenge(walletAddress);
    res.json({ challenge });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

const verifySchema = z.object({
  walletAddress: z.string().refine((val) => StrKey.isValidEd25519PublicKey(val), {
    message: 'Invalid Stellar public key',
  }),
  signedChallenge: z.string(),
});

router.post('/verify', limiter, async (req, res) => {
  try {
    const { walletAddress, signedChallenge } = verifySchema.parse(req.body);
    const token = await AuthService.verifySignatureAndIssueJWT(walletAddress, signedChallenge);
    res.json({ token });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: err.errors });
    } else {
      res.status(401).json({ error: err.message });
    }
  }
});

export { router as authRoutes };

