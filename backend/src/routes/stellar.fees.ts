import { Router, Request, Response } from "express";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

export function createStellarFeesRouter(): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const feeStats = await horizonServer.feeStats();

      res.json({
        feeCharged: feeStats.fee_charged,
        maxFee: feeStats.max_fee,
        ledger: parseInt(feeStats.last_ledger, 10),
        lastLedgerBaseFee: parseInt(feeStats.last_ledger_base_fee, 10),
      });
    } catch (error) {
      appLogger.error({ error }, "Failed to fetch Stellar fee stats");
      res.status(502).json({
        error: "Failed to fetch fee data from Stellar network",
      });
    }
  });

  return router;
}

export const stellarFeesRoutes = createStellarFeesRouter();
