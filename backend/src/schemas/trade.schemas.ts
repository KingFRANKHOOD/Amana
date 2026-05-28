import { z } from "zod";
import { TradeStatus } from "@prisma/client";

export const createTradeSchema = z.object({
  buyerAddress: z.string().min(1, "Buyer address is required").optional(),
  sellerAddress: z.string().min(1, "Seller address is required"),
  amountUsdc: z.union([
    z.string().regex(/^\d+(\.\d{1,7})?$/, "Invalid amount format"),
    z.number().positive("Amount must be positive").transform(String),
  ]),
  buyerLossBps: z.number().int().min(0, "buyerLossBps must be >= 0").max(10000, "buyerLossBps must be <= 10000").optional(),
  sellerLossBps: z.number().int().min(0, "sellerLossBps must be >= 0").max(10000, "sellerLossBps must be <= 10000").optional(),
  description: z.string().optional(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}).superRefine((data: any, ctx: any) => {
  const buyer = data.buyerLossBps ?? 5000;
  const seller = data.sellerLossBps ?? 5000;
  if (buyer + seller !== 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sum of buyerLossBps and sellerLossBps must equal 10000", path: ["buyerLossBps"] });
  }
});

export const tradeIdParamSchema = z.object({
  id: z.string().uuid("Invalid trade ID format"),
});

export const listTradesQuerySchema = z.object({
  status: z.nativeEnum(TradeStatus).optional(),
  page: z.preprocess((val: unknown) => Number(val), z.number().int().min(1).default(1)),
  limit: z.preprocess((val: unknown) => Number(val), z.number().int().min(1).max(100).default(20)),
  sort: z.string().optional(),
});

export const initiateDisputeSchema = z
  .object({
    reason: z.string().min(10, "Reason must be at least 10 characters"),
    category: z
      .string()
      .trim()
      .min(1, "Category string is required")
      .max(100, "Category must be 100 characters or fewer")
      .optional(),
    categoryId: z.number().int().positive("categoryId must be a positive integer").optional(),
  })
  .superRefine((data: { category?: string; categoryId?: number }, ctx: z.RefinementCtx) => {
    if (!data.category && data.categoryId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Category string is required",
        path: ["category"],
      });
    }
  });
