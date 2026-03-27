import { TradeStatus } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import type { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  buildConfirmDeliveryTx,
  buildReleaseFundsTx,
  ContractService,
} from "../services/contract.service";
import { appLogger } from "../middleware/logger";
import { TradeAccessDeniedError, TradeService, DisputeTradeStatusError } from "../services/trade.service";

const CALLER_HEADER = "x-stellar-address";
const AMOUNT_USDC_PATTERN = /^\d+(?:\.\d{1,7})?$/;

interface CreateTradeBody {
  sellerAddress?: unknown;
  amountUsdc?: unknown;
  buyerLossBps?: unknown;
  sellerLossBps?: unknown;
}

export function getCallerStellarAddress(req: Request): string | undefined {
  const raw = req.headers[CALLER_HEADER];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (Array.isArray(raw) && raw[0]) {
    return String(raw[0]).trim();
  }
  return undefined;
}

function parseAdminPubkeys(): Set<string> {
  const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isBuyer(tradeBuyer: string, caller: string): boolean {
  return tradeBuyer === caller;
}

export function isSeller(tradeSeller: string, caller: string): boolean {
  return tradeSeller === caller;
}

export function isBuyerOrAdmin(
  tradeBuyer: string,
  caller: string,
  admins: Set<string> = parseAdminPubkeys(),
): boolean {
  return tradeBuyer === caller || admins.has(caller);
}


export class TradeController {
  constructor(
    private readonly tradeService: TradeService = new TradeService(),
    private readonly contractService: ContractService = new ContractService(),
  ) { }

  public createTrade = async (
    req: AuthRequest,
    res: Response,
  ): Promise<Response | void> => {
    try {
      const buyerAddress = req.user?.walletAddress;
      if (!buyerAddress) {
        return res
          .status(400)
          .json({ error: "Wallet address not found in token" });
      }

      if (!this.isValidPublicKey(buyerAddress)) {
        return res.status(400).json({ error: "Invalid buyer wallet address" });
      }

      const { sellerAddress, amountUsdc, buyerLossBps, sellerLossBps } = req.body as CreateTradeBody;
      if (!this.isValidPublicKey(sellerAddress)) {
        return res.status(400).json({ error: "Invalid sellerAddress" });
      }

      const normalizedAmountUsdc = this.normalizeAmountUsdc(amountUsdc);
      if (!normalizedAmountUsdc) {
        return res.status(400).json({ error: "Invalid amountUsdc" });
      }

      if (!this.isValidLossBps(buyerLossBps)) {
        return res.status(400).json({ error: "buyerLossBps must be an integer between 0 and 10000" });
      }
      if (!this.isValidLossBps(sellerLossBps)) {
        return res.status(400).json({ error: "sellerLossBps must be an integer between 0 and 10000" });
      }
      if ((buyerLossBps as number) + (sellerLossBps as number) !== 10000) {
        return res.status(400).json({ error: "buyerLossBps and sellerLossBps must sum to 10000" });
      }

      const { tradeId, unsignedXdr } =
        await this.contractService.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amountUsdc: normalizedAmountUsdc,
          buyerLossBps: buyerLossBps as number,
          sellerLossBps: sellerLossBps as number,
        });

      await this.tradeService.createPendingTrade({
        tradeId,
        buyerAddress,
        sellerAddress,
        amountUsdc: normalizedAmountUsdc,
        buyerLossBps: buyerLossBps as number,
        sellerLossBps: sellerLossBps as number,
      });

      return res.status(201).json({ tradeId, unsignedXdr });
    } catch (error) {
      appLogger.error({ error }, "Trade creation failed");
      return res.status(500).json({ error: "Failed to create trade" });
    }
  };

  public buildDepositTx = async (
    req: AuthRequest,
    res: Response,
  ): Promise<Response | void> => {
    try {
      const tradeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!tradeId) {
        return res.status(400).json({ error: "Trade id is required" });
      }

      const callerAddress = req.user?.walletAddress;
      if (!callerAddress) {
        return res
          .status(400)
          .json({ error: "Wallet address not found in token" });
      }

      if (!this.isValidPublicKey(callerAddress)) {
        return res.status(400).json({ error: "Invalid buyer wallet address" });
      }

      const trade = await this.tradeService.getTradeById(tradeId, callerAddress);
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      if (trade.buyer !== callerAddress) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (trade.status !== TradeStatus.CREATED) {
        return res
          .status(400)
          .json({ error: "Trade must be in CREATED status" });
      }

      const { unsignedXdr } = await this.contractService.buildDepositTx(trade);
      return res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof TradeAccessDeniedError) {
        return res.status(403).json({ error: "Forbidden" });
      }

      appLogger.error({ error }, "Deposit transaction build failed");
      return res
        .status(500)
        .json({ error: "Failed to build deposit transaction" });
    }
  };

  public confirmDelivery = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const caller = getCallerStellarAddress(req);
    if (!caller) {
      res.status(401).json({ error: "Missing X-Stellar-Address header" });
      return;
    }

    try {
      const trade = await this.tradeService.getTradeById(id, caller);
      if (!trade) {
        res.status(404).json({ error: "Trade not found" });
        return;
      }

      if (trade.status !== TradeStatus.FUNDED) {
        res.status(400).json({
          error: `Trade must be FUNDED to confirm delivery (current: ${trade.status})`,
        });
        return;
      }

      if (!isBuyer(trade.buyerAddress, caller)) {
        res.status(403).json({ error: "Only the buyer may confirm delivery" });
        return;
      }

      const unsignedXdr = await buildConfirmDeliveryTx(trade, caller);
      res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof TradeAccessDeniedError) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  };

  public releaseFunds = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const caller = getCallerStellarAddress(req);
    if (!caller) {
      res.status(401).json({ error: "Missing X-Stellar-Address header" });
      return;
    }

    try {
      const trade = await this.tradeService.getTradeById(id, caller);
      if (!trade) {
        res.status(404).json({ error: "Trade not found" });
        return;
      }

      if (trade.status !== TradeStatus.DELIVERED) {
        res.status(400).json({
          error: `Trade must be DELIVERED to release funds (current: ${trade.status})`,
        });
        return;
      }

      if (!isBuyerOrAdmin(trade.buyerAddress, caller)) {
        res
          .status(403)
          .json({ error: "Only the buyer or an admin may release funds" });
        return;
      }

      const unsignedXdr = await buildReleaseFundsTx(trade, caller);
      res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof TradeAccessDeniedError) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  };

  public initiateDispute = async (
    req: AuthRequest,
    res: Response,
  ): Promise<Response | void> => {
    try {
      const tradeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!tradeId) {
        return res.status(400).json({ error: "Trade id is required" });
      }

      const callerAddress = req.user?.walletAddress;
      if (!callerAddress) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { reason, category } = req.body as { reason?: unknown; category?: unknown };
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "Reason string is required" });
      }
      if (!category || typeof category !== "string") {
        return res.status(400).json({ error: "Category string is required" });
      }

      const { unsignedXdr } = await this.tradeService.initiateDispute(
        tradeId,
        callerAddress,
        reason,
        category,
      );

      return res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof TradeAccessDeniedError) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (error instanceof DisputeTradeStatusError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof Error && error.message === "Trade not found") {
        return res.status(404).json({ error: "Trade not found" });
      }

      console.error("Dispute initiation failed:", error);
      return res.status(500).json({ error: "Failed to initiate dispute" });
    }
  };
  private isValidPublicKey(value: unknown): value is string {
    return (
      typeof value === "string" &&
      StellarSdk.StrKey.isValidEd25519PublicKey(value)
    );
  }

  private isValidLossBps(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000;
  }

  private normalizeAmountUsdc(value: unknown): string | null {
    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }

    const normalized = String(value).trim();
    if (!AMOUNT_USDC_PATTERN.test(normalized)) {
      return null;
    }

    if (Number(normalized) <= 0) {
      return null;
    }

    return normalized;
  }
}
