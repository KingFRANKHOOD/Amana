import { Router, Request, Response } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

interface Balance {
  assetType: string;
  assetCode: string;
  issuer: string | null;
  balance: string;
  limit: string | null;
}

function parseBalances(rawBalances: any[]): Balance[] {
  return rawBalances.map((b) => {
    if (b.asset_type === "native") {
      return {
        assetType: "native",
        assetCode: "XLM",
        issuer: null,
        balance: b.balance,
        limit: null,
      };
    }
    return {
      assetType: b.asset_type,
      assetCode: b.asset_code ?? "",
      issuer: b.asset_issuer ?? null,
      balance: b.balance,
      limit: b.limit ?? null,
    };
  });
}

export function createStellarAccountBalanceRouter(): Router {
  const router = Router();

  // GET /stellar/account/:address/balance
  router.get("/:address/balance", async (req: Request, res: Response) => {
    const address = req.params.address as string;

    if (!address || !StrKey.isValidEd25519PublicKey(address)) {
      res.status(400).json({ error: { code: "INVALID_ADDRESS", message: "Invalid Stellar account address" } });
      return;
    }

    try {
      const account = await horizonServer.loadAccount(address);
      const balances = parseBalances(account.balances);

      res.json({ address, balances });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        res
          .status(404)
          .json({ error: { code: "ACCOUNT_NOT_FOUND", message: "Stellar account not found" } });
        return;
      }

      appLogger.error({ error, address }, "Failed to fetch account balances");
      res
        .status(502)
        .json({ error: { code: "STELLAR_FETCH_FAILED", message: "Failed to fetch account data from Stellar network" } });
    }
  });

  return router;
}

export const stellarAccountBalanceRoutes = createStellarAccountBalanceRouter();
