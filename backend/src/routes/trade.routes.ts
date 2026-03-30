import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { TradeController } from "../controllers/trade.controller";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";

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

  router.post("/", authMiddleware, tradeController.createTrade);
  router.post("/:id/deposit", authMiddleware, tradeController.buildDepositTx);
  router.post("/:id/confirm", authMiddleware, tradeController.confirmDelivery);
  router.post("/:id/release", authMiddleware, tradeController.releaseFunds);
  router.post("/:id/dispute", authMiddleware, tradeController.initiateDispute);

  router.get("/", authMiddleware, async (req: AuthRequest, res) => {
    const callerAddress = requireWalletFromJwt(req, res);
    if (!callerAddress) {
      return;
    }

    const statusRaw = req.query.status as string | undefined;
    const pageRaw = req.query.page as string | undefined;
    const limitRaw = req.query.limit as string | undefined;
    const sort = req.query.sort as string | undefined;

    let status: TradeStatus | undefined;
    if (statusRaw) {
      if (!(statusRaw in TradeStatus)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      status = statusRaw as TradeStatus;
    }

    const page = pageRaw ? Number(pageRaw) : 1;
    const limit = limitRaw ? Number(limitRaw) : 20;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
      res.status(400).json({ error: "Invalid pagination params" });
      return;
    }

    const result = await tradeService.listUserTrades(callerAddress, {
      status,
      page,
      limit,
      sort,
    });

    res.status(200).json(result);
  });

  router.get("/stats", authMiddleware, async (req: AuthRequest, res) => {
    const callerAddress = requireWalletFromJwt(req, res);
    if (!callerAddress) {
      return;
    }

    const stats = await tradeService.getUserStats(callerAddress);
    res.status(200).json(stats);
  });

  router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
    const callerAddress = requireWalletFromJwt(req, res);
    if (!callerAddress) {
      return;
    }

    try {
      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
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
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

export const tradeRoutes = createTradeRouter();
