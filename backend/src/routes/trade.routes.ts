import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  listUserTrades,
  getTradeById,
  getUserStats,
  ValidationError,
} from "../services/trade.service";

const tradeRouter = Router();

tradeRouter.use(authMiddleware);

// GET /trades — paginated list of caller's trades
tradeRouter.get("/", async (req: Request, res: Response) => {
  const { status, page, limit, sort } = req.query;

  const pageNum = page ? parseInt(page as string, 10) : undefined;
  const limitNum = limit ? parseInt(limit as string, 10) : undefined;

  if (page && (isNaN(pageNum!) || pageNum! < 1)) {
    res.status(400).json({ error: "page must be a positive integer" });
    return;
  }
  if (limit && (isNaN(limitNum!) || limitNum! < 1)) {
    res.status(400).json({ error: "limit must be a positive integer" });
    return;
  }
  if (limitNum && limitNum > 100) {
    res.status(400).json({ error: "limit must not exceed 100" });
    return;
  }

  try {
    const result = await listUserTrades(req.userAddress!, {
      status: status as string | undefined,
      page: pageNum,
      limit: limitNum,
      sort: sort as string | undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// GET /trades/stats — must be before /:id
tradeRouter.get("/stats", async (req: Request, res: Response) => {
  const stats = await getUserStats(req.userAddress!);
  res.json(stats);
});

// GET /trades/:id — single trade detail
tradeRouter.get("/:id", async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid trade ID" });
    return;
  }

  const { trade, error } = await getTradeById(id, req.userAddress!);

  if (error === "not_found") {
    res.status(404).json({ error: "Trade not found" });
    return;
  }
  if (error === "forbidden") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(trade);
});

export default tradeRouter;
