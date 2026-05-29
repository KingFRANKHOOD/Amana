import { TradeStatus } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import type { NextFunction, Response } from "express";
import { AuthRequest } from "../services/auth.service";
import {
  buildConfirmDeliveryTx,
  buildReleaseFundsTx,
  ContractService,
} from "../services/contract.service";
import { appLogger } from "../middleware/logger";
import {
  TradeAccessDeniedError,
  TradeService,
  DisputeTradeStatusError,
  DisputeCategoryValidationError,
} from "../services/trade.service";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { getMediatorAllowlist } from "../lib/accessControl";

const AMOUNT_USDC_PATTERN = /^\d+(?:\.\d{1,7})?$/;

interface CreateTradeBody {
  sellerAddress?: unknown;
  amountUsdc?: unknown;
  buyerLossBps?: unknown;
  sellerLossBps?: unknown;
}

function parseAdminPubkeys(): Set<string> {
  return getMediatorAllowlist();
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
  ) {}

  public createTrade = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const buyerAddress = req.user?.walletAddress;
      if (!buyerAddress) {
        throw new AppError(ErrorCode.AUTH_ERROR, "Wallet address not found in token", 401);
      }

      if (!this.isValidPublicKey(buyerAddress)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid buyer wallet address", 400);
      }

      const { sellerAddress, amountUsdc, buyerLossBps, sellerLossBps } = req.body as CreateTradeBody;
      if (!this.isValidPublicKey(sellerAddress)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid sellerAddress", 400);
      }

      const normalizedAmountUsdc = this.normalizeAmountUsdc(amountUsdc);
      if (!normalizedAmountUsdc) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid amountUsdc", 400);
      }

      if (!this.isValidLossBps(buyerLossBps)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "buyerLossBps must be an integer between 0 and 10000",
          400,
        );
      }
      if (!this.isValidLossBps(sellerLossBps)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "sellerLossBps must be an integer between 0 and 10000",
          400,
        );
      }
      if ((buyerLossBps as number) + (sellerLossBps as number) !== 10000) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "buyerLossBps and sellerLossBps must sum to 10000",
          400,
        );
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
      if (error instanceof AppError) return next(error);
      appLogger.error({ error }, "Trade creation failed");
      return next(
        new AppError(ErrorCode.TRADE_BUILD_FAILED, "Failed to create trade", 500),
      );
    }
  };

  public buildDepositTx = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const tradeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!tradeId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Trade id is required", 400);
      }

      const callerAddress = req.user?.walletAddress;
      if (!callerAddress) {
        throw new AppError(ErrorCode.AUTH_ERROR, "Wallet address not found in token", 401);
      }

      if (!this.isValidPublicKey(callerAddress)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid buyer wallet address", 400);
      }

      const trade = await this.tradeService.getTradeById(tradeId, callerAddress);
      if (!trade) {
        throw new AppError(ErrorCode.TRADE_NOT_FOUND, "Trade not found", 404);
      }

      if (trade.buyerAddress !== callerAddress) {
        throw new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Forbidden", 403);
      }

      if (trade.status !== TradeStatus.CREATED) {
        throw new AppError(
          ErrorCode.TRADE_INVALID_STATUS,
          "Trade must be in CREATED status",
          400,
          { currentStatus: trade.status },
        );
      }

      const { unsignedXdr } = await this.contractService.buildDepositTx(trade);
      return res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error instanceof TradeAccessDeniedError) {
        return next(new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Forbidden", 403));
      }
      appLogger.error({ error }, "Deposit transaction build failed");
      return next(
        new AppError(ErrorCode.TRADE_BUILD_FAILED, "Failed to build deposit transaction", 500),
      );
    }
  };

  public confirmDelivery = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const caller = req.user?.walletAddress?.trim();
    if (!caller) {
      next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
      return;
    }

    try {
      const trade = await this.tradeService.getTradeById(id, caller);
      if (!trade) {
        next(new AppError(ErrorCode.TRADE_NOT_FOUND, "Trade not found", 404));
        return;
      }

      if (trade.status !== TradeStatus.FUNDED) {
        next(
          new AppError(
            ErrorCode.TRADE_INVALID_STATUS,
            `Trade must be FUNDED to confirm delivery (current: ${trade.status})`,
            400,
            { currentStatus: trade.status },
          ),
        );
        return;
      }

      if (!isBuyer(trade.buyerAddress, caller)) {
        next(new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Only the buyer may confirm delivery", 403));
        return;
      }

      const unsignedXdr = await buildConfirmDeliveryTx(trade, caller);
      res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      if (error instanceof TradeAccessDeniedError) {
        next(new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Forbidden", 403));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      next(new AppError(ErrorCode.TRADE_BUILD_FAILED, message, 500));
    }
  };

  public releaseFunds = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const caller = req.user?.walletAddress?.trim();
    if (!caller) {
      next(new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401));
      return;
    }

    try {
      const trade = await this.tradeService.getTradeById(id, caller);
      if (!trade) {
        next(new AppError(ErrorCode.TRADE_NOT_FOUND, "Trade not found", 404));
        return;
      }

      if (trade.status !== TradeStatus.DELIVERED) {
        next(
          new AppError(
            ErrorCode.TRADE_INVALID_STATUS,
            `Trade must be DELIVERED to release funds (current: ${trade.status})`,
            400,
            { currentStatus: trade.status },
          ),
        );
        return;
      }

      if (!isBuyerOrAdmin(trade.buyerAddress, caller)) {
        next(
          new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Only the buyer or an admin may release funds", 403),
        );
        return;
      }

      const unsignedXdr = await buildReleaseFundsTx(trade, caller);
      res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      if (error instanceof TradeAccessDeniedError) {
        next(new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Forbidden", 403));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      next(new AppError(ErrorCode.TRADE_BUILD_FAILED, message, 500));
    }
  };

  public initiateDispute = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const tradeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!tradeId) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Trade id is required", 400);
      }

      const callerAddress = req.user?.walletAddress;
      if (!callerAddress) {
        throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized", 401);
      }

      const { reason, category, categoryId } = req.body as {
        reason?: unknown;
        category?: unknown;
        categoryId?: unknown;
      };
      if (!reason || typeof reason !== "string") {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Reason string is required", 400);
      }

      const parsedCategoryId =
        categoryId !== undefined
          ? typeof categoryId === "number" && Number.isInteger(categoryId) && categoryId > 0
            ? categoryId
            : null
          : undefined;

      if (categoryId !== undefined && parsedCategoryId === null) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "categoryId must be a positive integer", 400);
      }

      const { unsignedXdr } = await this.tradeService.initiateDispute(
        tradeId,
        callerAddress,
        reason,
        typeof category === "string" ? category : "",
        parsedCategoryId ?? undefined,
      );

      return res.status(200).json({ unsignedXdr });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error instanceof TradeAccessDeniedError) {
        return next(new AppError(ErrorCode.TRADE_ACCESS_DENIED, "Forbidden", 403));
      }
      if (error instanceof DisputeTradeStatusError) {
        return next(
          new AppError(ErrorCode.TRADE_INVALID_STATUS, error.message, 400, {
            currentStatus: (error as any).status,
          }),
        );
      }
      if (error instanceof DisputeCategoryValidationError) {
        return next(
          new AppError(ErrorCode.DISPUTE_INVALID_CATEGORY, error.message, 400),
        );
      }
      if (error instanceof Error && error.message === "Trade not found") {
        return next(new AppError(ErrorCode.TRADE_NOT_FOUND, "Trade not found", 404));
      }

      appLogger.error({ error }, "Dispute initiation failed");
      return next(
        new AppError(ErrorCode.TRADE_BUILD_FAILED, "Failed to initiate dispute", 500),
      );
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
