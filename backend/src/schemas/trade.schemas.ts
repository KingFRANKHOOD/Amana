import { z } from "zod";
import { TradeStatus } from "@prisma/client";

export const createTradeSchema = z.object({
  buyerAddress: z.string().min(1, "Buyer address is required"),
  sellerAddress: z.string().min(1, "Seller address is required"),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/, "Invalid amount format"),
  description: z.string().optional(),
});

export const tradeIdParamSchema = z.object({
  id: z.string().uuid("Invalid trade ID format"),
});

export const listTradesQuerySchema = z.object({
  status: z.nativeEnum(TradeStatus).optional(),
  page: z.preprocess((val) => Number(val), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(100).default(20)),
  sort: z.string().optional(),
});

export const initiateDisputeSchema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});
