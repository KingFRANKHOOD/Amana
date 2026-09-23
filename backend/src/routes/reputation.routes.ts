import { Router } from "express";
import { prisma } from "../lib/db";
import { ReputationService } from "../services/reputation.service";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';

const router = Router();
const reputationService = new ReputationService(prisma);

router.get(
  "/me/reputation",
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const address = req.user?.walletAddress;
      if (!address) {
        return next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
      }
      const reputation = await reputationService.getUserReputation(address);
      res.json(reputation);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/:address/reputation",
  async (req, res, next) => {
    try {
      const raw = req.params.address;
      const address = Array.isArray(raw) ? raw[0] : raw;
      if (!address) {
        return next(new AppError(ErrorCode.VALIDATION_ERROR, "Wallet address is required", 400));
      }
      const reputation = await reputationService.getUserReputation(address);
      res.json(reputation);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
