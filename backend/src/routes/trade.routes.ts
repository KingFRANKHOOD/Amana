import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { TradeController } from "../controllers/trade.controller";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";
import { validateRequest } from "../middleware/validateRequest";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { 
  createTradeSchema, 
  tradeIdParamSchema, 
  listTradesQuerySchema, 
  initiateDisputeSchema 
} from "../schemas/trade.schemas";

export function createTradeRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();
  const tradeService = new TradeService(prisma);
  const tradeController = new TradeController(tradeService);

  const requireWalletFromJwt = (req: AuthRequest, res: Response): string | null => {
    const addr = req.user?.walletAddress?.trim();
    if (!addr) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return addr;
  };

  router.post(
    "/", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ body: createTradeSchema }),
    tradeController.createTrade
  );

  router.post(
    "/:id/deposit", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.buildDepositTx
  );

  router.post(
    "/:id/confirm", 
    authMiddleware, 
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.confirmDelivery
  );

  router.post(
    "/:id/release", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.releaseFunds
  );

  router.post(
    "/:id/dispute", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema, body: initiateDisputeSchema }),
    tradeController.initiateDispute
  );

  router.get(
    "/", 
    authMiddleware, 
    validateRequest({ query: listTradesQuerySchema }),
    async (req: AuthRequest, res) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      const { status, page, limit, sort } = req.query as any;

      const result = await tradeService.listUserTrades(callerAddress, {
        status,
        page,
        limit,
        sort,
      });

      res.status(200).json(result);
    }
  );

  router.get("/stats", authMiddleware, async (req: AuthRequest, res) => {
    const callerAddress = requireWalletFromJwt(req, res);
    if (!callerAddress) {
      return;
    }

    const stats = await tradeService.getUserStats(callerAddress);
    res.status(200).json(stats);
  });

  router.get(
    "/:id", 
    authMiddleware, 
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      try {
        const id = req.params.id as string;
        const trade = await tradeService.getTradeById(id, callerAddress);
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        res.status(200).json(trade);
      } catch (error) {
        if (error instanceof TradeAccessDeniedError) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        throw error; // Let centralized error handler handle it
      }
    }
  );

  return router;
}


export const tradeRoutes = createTradeRouter();
