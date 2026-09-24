import { PrismaClient } from "@prisma/client";
import { NextFunction, Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { tradeIdParamSchema } from "../schemas/trade.schemas";
import { AuthRequest } from "../services/auth.service";
import {
  TradeWatchlistService,
  WatchTradeAccessDeniedError,
  WatchTradeNotFoundError,
} from "../services/trade.watchlist.service";

/** Maximum items that can be returned in a single page for the watchlist. */
const WATCHLIST_MAX_LIMIT = 100;

const listWatchlistQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Number(v)),
    z.number().int().min(1).default(1),
  ),
  limit: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Number(v)),
    z.number().int().min(1).max(WATCHLIST_MAX_LIMIT).default(20),
  ),
});

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function handleWatchError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof WatchTradeNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof WatchTradeAccessDeniedError) {
    res.status(403).json({ error: error.message });
    return;
  }
  next(error);
}

export function createTradeWatchlistRouter(
  prisma: PrismaClient = defaultPrisma,
) {
  const router = Router();
  const watchlist = new TradeWatchlistService(prisma);

  router.post(
    "/:id/watch",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res, next) => {
      const userAddress = caller(req, res);
      if (!userAddress) return;
      try {
        const watch = await watchlist.add(String(req.params.id), userAddress);
        res.status(201).json({ watch });
      } catch (error) {
        handleWatchError(error, res, next);
      }
    },
  );

  router.delete(
    "/:id/watch",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res, next) => {
      const userAddress = caller(req, res);
      if (!userAddress) return;
      try {
        const result = await watchlist.remove(
          String(req.params.id),
          userAddress,
        );
        res.status(200).json(result);
      } catch (error) {
        handleWatchError(error, res, next);
      }
    },
  );

  router.get(
    "/watched",
    authMiddleware,
    validateRequest({ query: listWatchlistQuerySchema }),
    async (req: AuthRequest, res, next) => {
      const userAddress = caller(req, res);
      if (!userAddress) return;
      try {
        const { page, limit } = req.query as unknown as {
          page: number;
          limit: number;
        };
        const result = await watchlist.list(userAddress, page, limit);
        res.status(200).json({
          items: result.items,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / result.limit),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
