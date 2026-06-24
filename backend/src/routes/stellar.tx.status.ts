import { Router, Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

function parseResultCodes(resultXdr: string): { transaction: string; operations: string[] } {
  try {
    const xdr = Buffer.from(resultXdr, "base64");
    const result = StellarSdk.xdr.TransactionResult.fromXDR(xdr);
    const resultCode = result.result().switch();
    const transactionCode = (resultCode as any).name || "unknown";

    const opResults = result.result().results() || [];
    const operationCodes = opResults.map((op) => {
      const opResult = op.tr().switch();
      return (opResult as any).name || "unknown";
    });

    return {
      transaction: transactionCode,
      operations: operationCodes,
    };
  } catch {
    return { transaction: "unknown", operations: [] };
  }
}

export function createStellarTxStatusRouter(): Router {
  const router = Router();

  router.get("/:hash/status", async (req: Request, res: Response) => {
    const hash = req.params.hash as string;

    if (!hash || hash.length !== 64) {
      res.status(400).json({ error: "Invalid transaction hash" });
      return;
    }

    try {
      const txResponse = await horizonServer
        .transactions()
        .transaction(hash)
        .call();

      const resultCodes = parseResultCodes(txResponse.result_xdr);
      const status = txResponse.successful ? "success" : "failed";

      res.json({
        status,
        resultCodes,
        ledger: txResponse.ledger,
        hash: txResponse.id,
        createdAt: txResponse.created_at,
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        res.status(404).json({
          status: "pending",
          hash,
          message: "Transaction not found on Stellar network (may still be pending)",
        });
        return;
      }

      appLogger.error({ error, hash }, "Failed to fetch transaction status");
      res.status(502).json({
        error: "Failed to fetch transaction status from Stellar network",
      });
    }
  });

  return router;
}

export const stellarTxStatusRoutes = createStellarTxStatusRouter();
