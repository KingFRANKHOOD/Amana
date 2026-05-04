import { Response } from "express";
import { DisputeService } from "../services/dispute.service";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { Router } from "express";
import { z } from "zod";

const listDisputesQuerySchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class DisputeController {
  constructor(private disputeService: DisputeService) {}

  public listMediatorDisputes = async (req: AuthRequest, res: Response) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status, page, limit } = req.query as any;

    try {
      const result = await this.disputeService.listMediatorDisputes(callerAddress, {
        status,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (error) {
      console.error("List mediator disputes failed:", error);
      res.status(500).json({ error: "Failed to list disputes" });
    }
  };
}

export function createDisputeRouter(prisma = defaultPrisma) {
  const router = Router();
  const disputeService = new DisputeService(prisma);
  const disputeController = new DisputeController(disputeService);

  router.get(
    "/",
    authMiddleware,
    validateRequest({ query: listDisputesQuerySchema }),
    disputeController.listMediatorDisputes
  );

  return router;
}