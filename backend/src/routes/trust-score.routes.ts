import { Response, Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { TrustScoreService } from "../services/trustScore.service";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';
import { prisma } from "../lib/db";

const trustScoreService = new TrustScoreService(prisma);

export function createTrustScoreRouter() {
  const router = Router();

  router.get(
    "/me/trust-score",
    authMiddleware,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const address = req.user?.walletAddress;
        if (!address) {
          return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
        }
        const details = await trustScoreService.calculateTrustScore(address);
        res.json(details);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/:address/trust-score",
    async (req, res, next) => {
      try {
        const raw = req.params.address;
        const address = Array.isArray(raw) ? raw[0] : raw;
        if (!address) {
          return next(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              "Wallet address is required",
              400,
            ),
          );
        }
        const details = await trustScoreService.calculateTrustScore(address);
        res.json(details);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
