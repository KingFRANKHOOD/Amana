import { PrismaClient } from "@prisma/client";
import { NextFunction, Response, Router } from "express";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import { TradeNotesService } from "../services/trade.notes.service";
import { validateRequest } from "../middleware/validateRequest";
import {
  addNoteSchema,
  tradeIdParamSchema,
} from "../schemas/trade.notes.schemas";

export function createTradeNotesRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();
  const notesService = new TradeNotesService(prisma);

  const requireWalletFromJwt = (req: AuthRequest, res: Response): string | null => {
    const addr = req.user?.walletAddress?.trim();
    if (!addr) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return addr;
  };

  router.post(
    "/:id/notes",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema, body: addNoteSchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) return;

      try {
        const tradeId = req.params.id as string;
        const { content } = req.body as { content: string };
        const note = await notesService.addNote(tradeId, callerAddress, content);
        res.status(201).json({ id: note.id, createdAt: note.createdAt });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:id/notes",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) return;

      try {
        const tradeId = req.params.id as string;
        const notes = await notesService.listNotes(tradeId, callerAddress);
        res.status(200).json({ notes });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const tradeNotesRoutes = createTradeNotesRouter();
