import type { Response } from "express";
import { AuthRequest } from "../services/auth.service";
import { TreasuryService } from "../services/treasury.service";
import { appLogger } from "../middleware/logger";
import * as StellarSdk from "@stellar/stellar-sdk";

export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService = new TreasuryService()) {}

  getBalance = async (_req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const balance = await this.treasuryService.getBalance();
      return res.status(200).json(balance);
    } catch (error) {
      appLogger.error({ error }, "Failed to get treasury balance");
      return res.status(500).json({ error: "Failed to get treasury balance" });
    }
  };

  withdraw = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const callerAddress = req.user?.walletAddress;
      if (!callerAddress) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { destination, amount } = req.body as { destination?: unknown; amount?: unknown };
      if (!destination || typeof destination !== "string") {
        return res.status(400).json({ error: "Destination address is required" });
      }
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) {
        return res.status(400).json({ error: "Invalid destination address" });
      }
      if (!amount || typeof amount !== "string") {
        return res.status(400).json({ error: "Amount is required" });
      }

      const result = await this.treasuryService.withdraw(destination, amount, callerAddress);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Only admin can withdraw treasury funds") {
        return res.status(403).json({ error: error.message });
      }
      appLogger.error({ error }, "Treasury withdrawal failed");
      return res.status(500).json({ error: "Treasury withdrawal failed" });
    }
  };

  getConfig = async (_req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const config = this.treasuryService.getConfig();
      return res.status(200).json(config);
    } catch (error) {
      appLogger.error({ error }, "Failed to get treasury config");
      return res.status(500).json({ error: "Failed to get treasury config" });
    }
  };
}
