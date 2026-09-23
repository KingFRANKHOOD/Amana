import { NextFunction, Response, Router } from 'express';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { AuthService } from '../services/auth.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { AuthRequest } from '../services/auth.service';
import { RATE_LIMIT_CONFIG } from '../config/rateLimit';
import { createIpRateLimiter } from '../lib/rateLimit';
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  getCookie,
  setAuthCookies,
} from '../lib/authCookies';

const authLimiter = createIpRateLimiter(RATE_LIMIT_CONFIG.auth);
const refreshLimiter = createIpRateLimiter(RATE_LIMIT_CONFIG.authRefresh);

const router = Router();

const challengeSchema = z.object({
  walletAddress: z.string().refine((val: string) => StrKey.isValidEd25519PublicKey(val), {
    message: 'Invalid Stellar public key',
  }),
});

router.post('/challenge', authLimiter, async (req, res, next: NextFunction) => {
  try {
    const { walletAddress } = challengeSchema.parse(req.body);
    const challenge = await AuthService.generateChallenge(walletAddress);
    res.json({ challenge });
  } catch (err: unknown) {
    next(err);
  }
});

const verifySchema = z.object({
  walletAddress: z.string().refine((val: string) => StrKey.isValidEd25519PublicKey(val), {
    message: 'Invalid Stellar public key',
  }),
  signedChallenge: z.string(),
});

router.post('/verify', authLimiter, async (req, res, next: NextFunction) => {
  try {
    const { walletAddress, signedChallenge } = verifySchema.parse(req.body);
    const accessToken = await AuthService.verifySignatureAndIssueJWT(walletAddress, signedChallenge);
    const session = await AuthService.issueSession(walletAddress, accessToken);
    setAuthCookies(res, session);
    res.json({ authenticated: true });
  } catch (err: unknown) {
    next(err);
  }
});

router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const jti = req.user?.jti;
    const exp = req.user?.exp;
    if (jti && exp) {
      await AuthService.revokeToken(jti, exp);
    }
    await AuthService.revokeRefreshToken(getCookie(req, REFRESH_TOKEN_COOKIE));
    clearAuthCookies(res);
    res.json({ message: 'Logged out successfully' });
  } catch (err: unknown) {
    clearAuthCookies(res);
    if (err instanceof Error && (err as any).name === 'AppError') {
      next(err);
      return;
    }
    next(new AppError(ErrorCode.INTERNAL_ERROR, 'Logout failed', 500));
  }
});

router.post('/refresh', refreshLimiter, async (req, res, next: NextFunction) => {
  try {
    const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      clearAuthCookies(res);
      throw new AppError(ErrorCode.AUTH_ERROR, 'Missing refresh token cookie', 401);
    }
    const session = await AuthService.rotateRefreshToken(refreshToken);
    setAuthCookies(res, session);
    res.json({ authenticated: true });
  } catch (err: unknown) {
    clearAuthCookies(res);
    next(err);
  }
});

router.get('/validate', authMiddleware, (req: AuthRequest, res: Response) => {
  // Return only a bounded public profile — never expose internal JWT claims (jti, sub, exp, etc.)
  const walletAddress =
    req.user?.walletAddress?.toLowerCase() ?? req.user?.sub?.toLowerCase() ?? null;
  if (!walletAddress) {
    res.status(401).json({
      code: ErrorCode.AUTH_ERROR,
      message: 'Unauthorized',
    });
    return;
  }
  res.json({ valid: true, user: { walletAddress } });
});

export { router as authRoutes };
