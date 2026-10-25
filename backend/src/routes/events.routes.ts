import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { EventIndexerService } from "../services/event-indexer";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { AuthRequest } from "../services/auth.service";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { tradeIdParamSchema } from "../schemas/trade.notes.schemas";
import { appLogger } from "../middleware/logger";

const eventQueryLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.eventQuery);
const eventBackfillLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.eventBackfill);

const eventsQuerySchema = z
  .object({
    trade_id: z.string().trim().min(1).max(255).optional(),
    type: z.string().trim().min(1).max(100).optional(),
    from: z.coerce.number().int().nonnegative().finite().optional(),
    to: z.coerce.number().int().nonnegative().finite().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: "from must be less than or equal to to",
    path: ["from"],
  });

const backfillBodySchema = z
  .object({
    from: z.coerce.number().int().nonnegative().finite().optional(),
    to: z.coerce.number().int().positive().finite().optional(),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: "from must be less than or equal to to",
    path: ["from"],
  });

export function createEventRouter(prisma: PrismaClient, indexer: EventIndexerService): Router {
  const router = Router();

  router.get(
    "/events",
    authMiddleware,
    eventQueryLimiter,
    validateRequest({ query: eventsQuerySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const query = req.query as unknown as z.infer<typeof eventsQuerySchema>;

        const result = await indexer.queryEvents({
          tradeId: query.trade_id,
          type: query.type,
          from: query.from,
          to: query.to,
          limit: query.limit,
          offset: query.offset,
        });

        res.json({ data: result });
      } catch (error) {
        appLogger.error({ error }, "[EventsRouter] Failed to query events");
        res.status(500).json({ error: "Failed to query events" });
      }
    },
  );

  router.get(
    "/events/lag",
    authMiddleware,
    adminMiddleware,
    eventQueryLimiter,
    async (_req: AuthRequest, res: Response) => {
      try {
        const db = prisma as any;
        const latest = await db.indexedEvent.findFirst({
          orderBy: { ledgerSequence: "desc" },
          select: { ledgerSequence: true, ingestedAt: true },
        });

        res.json({
          lastIngestedLedger: indexer.getLastIngestedLedger(),
          latestPersistedLedger: latest?.ledgerSequence ?? null,
          latestIngestedAt: latest?.ingestedAt ?? null,
        });
      } catch (error) {
        appLogger.error({ error }, "[EventsRouter] Failed to get indexer lag");
        res.status(500).json({ error: "Failed to get indexer lag" });
      }
    },
  );

  router.post(
    "/events/backfill",
    authMiddleware,
    adminMiddleware,
    eventBackfillLimiter,
    validateRequest({ body: backfillBodySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const { from, to } = req.body as z.infer<typeof backfillBodySchema>;
        const result = await indexer.backfill(from, to);
        res.json(result);
      } catch (error) {
        appLogger.error({ error }, "[EventsRouter] Failed to trigger backfill");
        res.status(500).json({ error: "Failed to trigger backfill" });
      }
    },
  );

  router.get(
    "/trades/:id/timeline",
    authMiddleware,
    eventQueryLimiter,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id as string;
        const caller = req.user?.walletAddress?.trim().toLowerCase();
        if (!caller) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const trade = await prisma.trade.findUnique({ where: { tradeId: id } });
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        const isAdmin = getAdminAllowlistLowercase().has(caller);
        const isParty =
          trade.buyerAddress?.toLowerCase() === caller || trade.sellerAddress?.toLowerCase() === caller;

        if (!isAdmin && !isParty) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }

        const timeline = await indexer.getTradeTimeline(id);
        res.json({ data: timeline });
      } catch (error) {
        appLogger.error({ error }, "[EventsRouter] Failed to get trade timeline");
        next(error);
      }
    },
  );

  return router;
}
