import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { tradeStatusEvents, TradeStatusEvent } from "../services/tradeStatusEvents";

const eventStreamQuerySchema = z.object({
  token: z.string().min(1).optional(),
  trade_ids: z
    .string()
    .refine((value) => value.split(",").every((id) => id.trim() !== "" && /^[A-Za-z0-9_-]+$/.test(id.trim())), { message: "trade_ids must be a comma-separated list of trade IDs" })
    .optional(),
});

function parseTradeIds(value: unknown): Set<string> {
  if (typeof value !== "string" || value.trim() === "") return new Set();
  return new Set(value.split(",").map((id) => id.trim()).filter(Boolean));
}

function writeEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function allowEventSourceToken(req: Request, _res: Response, next: NextFunction) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }
  next();
}

export function createTradeEventsRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get("/events/stream", allowEventSourceToken, authMiddleware, validateRequest({ query: eventStreamQuerySchema }), (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const walletAddress = authReq.user?.walletAddress?.trim();
    if (!walletAddress) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const tradeIds = parseTradeIds(req.query.trade_ids);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    writeEvent(res, "connected", {
      event_type: "connected",
      timestamp: new Date().toISOString(),
    });

    const onTradeStatus = (event: TradeStatusEvent) => {
      if (tradeIds.size > 0 && !tradeIds.has(event.trade_id)) return;
      void prisma.trade.findFirst({
        where: {
          tradeId: event.trade_id,
          OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
        },
        select: { tradeId: true },
      }).then((trade) => {
        if (trade) {
          writeEvent(res, "trade_status", event);
        }
      }).catch(() => {
        writeEvent(res, "error", {
          event_type: "stream_error",
          timestamp: new Date().toISOString(),
        });
      });
    };

    const heartbeat = setInterval(() => {
      writeEvent(res, "heartbeat", { timestamp: new Date().toISOString() });
    }, 30_000);

    tradeStatusEvents.on("trade-status", onTradeStatus);

    req.on("close", () => {
      clearInterval(heartbeat);
      tradeStatusEvents.off("trade-status", onTradeStatus);
      res.end();
    });
  });

  return router;
}
