import { z } from "zod";
import { TradeStatus } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";

const stellarPublicKey = (fieldName: string) =>
  z.string().refine((v: string) => StrKey.isValidEd25519PublicKey(v), {
    message: `Invalid Stellar public key for ${fieldName}`,
  });

/**
 * Coerce a query-string parameter to a number while producing a clear,
 * actionable validation error for non-numeric input.
 *
 * `z.coerce.number()` would silently turn `"abc"` into `NaN` and surface a
 * cryptic `Expected number, received nan` message. Instead we attempt the
 * coercion explicitly and throw a descriptive ZodError when the value cannot
 * be parsed, so the value is rejected before it ever reaches business logic.
 */
function numericQueryParam(
  field: string,
  schema: z.ZodTypeAny,
) {
  return z.preprocess((val: unknown) => {
    if (val === undefined || val === null || val === "") return undefined;
    const coerced = Number(val);
    if (Number.isNaN(coerced)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be a valid number`,
        },
      ]);
    }
    return coerced;
  }, schema);
}

export const createTradeSchema = z.object({
  buyerAddress: stellarPublicKey("buyerAddress").optional(),
  sellerAddress: stellarPublicKey("sellerAddress"),
  amountUsdc: z.union([
    z.string().regex(/^\d+(\.\d{1,7})?$/, "Invalid amount format"),
    z.number().positive("Amount must be positive").transform(String),
  ]),
  buyerLossBps: z.number().int().min(0, "buyerLossBps must be >= 0").max(10000, "buyerLossBps must be <= 10000").default(5000),
  sellerLossBps: z.number().int().min(0, "sellerLossBps must be >= 0").max(10000, "sellerLossBps must be <= 10000").default(5000),
  description: z.string().optional(),
}).superRefine((data: Record<string, unknown>, ctx: any) => {
  const buyer = (data.buyerLossBps as number) ?? 5000;
  const seller = (data.sellerLossBps as number) ?? 5000;
  if (buyer + seller !== 10000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sum of buyerLossBps and sellerLossBps must equal 10000", path: ["buyerLossBps"] });
  }
});

export const tradeIdParamSchema = z.object({
  id: z.string().min(1, "Trade ID is required"),
});

export const listTradesQuerySchema = z.object({
  status: z.nativeEnum(TradeStatus).optional(),
  page: numericQueryParam("page", z.number().int().min(1).default(1)),
  limit: numericQueryParam("limit", z.number().int().min(1).max(100).default(20)),
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
  .superRefine((data: { category?: string; categoryId?: number }, ctx: any) => {
    if (!data.category && data.categoryId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Category string is required",
        path: ["category"],
      });
    }
  });
