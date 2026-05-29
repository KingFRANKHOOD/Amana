import { Router } from "express";
import { TreasuryController } from "../controllers/treasury.controller";
import { TreasuryService } from "../services/treasury.service";
import { authMiddleware } from "../middleware/auth.middleware";

export function createTreasuryRouter(): Router {
  const router = Router();
  const treasuryService = new TreasuryService();
  const treasuryController = new TreasuryController(treasuryService);

  router.get("/balance", authMiddleware, treasuryController.getBalance);
  router.post("/withdraw", authMiddleware, treasuryController.withdraw);
  router.get("/config", authMiddleware, treasuryController.getConfig);

  return router;
}

export const treasuryRoutes = createTreasuryRouter();
