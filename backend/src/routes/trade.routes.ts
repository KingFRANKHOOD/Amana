import { TradeStatus, PrismaClient } from "@prisma/client";
import { Request, Response, Router } from "express";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";

export function createTradeRouter(prisma: PrismaClient) {
  const router = Router();
  const tradeService = new TradeService(prisma);

  const getCallerAddress = (req: Request): string | null => {
    const headerAddress = req.header("x-wallet-address") || req.header("x-address");
    if (!headerAddress || !headerAddress.trim()) {
      return null;
    }
    return headerAddress.trim();
  };

  const requireAuth = (req: Request, res: Response): string | null => {
    const callerAddress = getCallerAddress(req);
    if (!callerAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return callerAddress;
  };

  router.get("/", async (req, res) => {
    const callerAddress = requireAuth(req, res);
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

  router.get("/stats", async (req, res) => {
    const callerAddress = requireAuth(req, res);
    if (!callerAddress) {
      return;
    }

    const stats = await tradeService.getUserStats(callerAddress);
    res.status(200).json(stats);
  });

  router.get("/:id", async (req, res) => {
    const callerAddress = requireAuth(req, res);
    if (!callerAddress) {
      return;
    }

    try {
      const trade = await tradeService.getTradeById(req.params.id, callerAddress);
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
