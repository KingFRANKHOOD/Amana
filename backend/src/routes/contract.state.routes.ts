import { NextFunction, Response, Router } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { StellarService } from "../services/stellar.service";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { validateRequest } from "../middleware/validateRequest";

const contractStateParamsSchema = z.object({
  contractId: z.string().regex(/^C[A-Z2-7]{55}$/, "Invalid Soroban contract id"),
});

const contractStateQuerySchema = z.object({
  tradeId: z.string().min(1, "tradeId query parameter is required"),
});

export function createContractStateRouter(
  stellarService: Pick<StellarService, "getContractTradeState"> = new StellarService(),
  prisma: PrismaClient = defaultPrisma,
): Router {
  const router = Router();

  router.get(
    "/:contractId/state",
    authMiddleware,
    validateRequest({ params: contractStateParamsSchema, query: contractStateQuerySchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const contractId = String(req.params.contractId);
      const tradeId = String(req.query.tradeId);

      try {
        const trade = await prisma.trade.findUnique({ where: { tradeId } });
        if (!trade) {
          return next(new AppError(ErrorCode.NOT_FOUND, "Trade not found", 404));
        }

        const caller = req.user?.walletAddress?.trim().toLowerCase();
        const isAdmin = !!caller && getAdminAllowlistLowercase().has(caller);
        const isParty =
          !!caller &&
          (trade.buyerAddress.toLowerCase() === caller ||
            trade.sellerAddress.toLowerCase() === caller);

        if (!isParty && !isAdmin) {
          return next(new AppError(ErrorCode.FORBIDDEN, "Forbidden", 403));
        }

        const state = await stellarService.getContractTradeState(contractId, tradeId);
        res.json({ contractId, tradeId, state });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
