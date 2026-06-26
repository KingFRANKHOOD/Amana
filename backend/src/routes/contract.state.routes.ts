import { NextFunction, Request, Response, Router } from "express";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { StellarService } from "../services/stellar.service";

export function createContractStateRouter(
  stellarService: Pick<StellarService, "getContractTradeState"> = new StellarService(),
): Router {
  const router = Router();

  router.get(
    "/:contractId/state",
    async (req: Request, res: Response, next: NextFunction) => {
      const contractId = String(req.params.contractId ?? "");
      const tradeId = String(req.query.tradeId ?? "");

      if (!tradeId) {
        return next(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            "tradeId query parameter is required",
            400,
          ),
        );
      }

      try {
        const state = await stellarService.getContractTradeState(contractId, tradeId);
        res.json({ contractId, tradeId, state });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
