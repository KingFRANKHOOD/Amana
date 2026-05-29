import { z } from "zod";
import { TradeStatus } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";

const stellarPublicKey = z
  .string()
  .refine(
    (v) => StellarSdk.StrKey.isValidEd25519PublicKey(v),
    { message: "Must be a valid Stellar Ed25519 public key" },
  );

const positiveAmountString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(
    z
      .string()
      .regex(/^\d+(\.\d{1,7})?$/, "amountUsdc must be a positive number with up to 7 decimal places")
      .refine((v) => Number(v) > 0, "amountUsdc must be greater than 0"),
  );

const lossBps = z
  .number({ invalid_type_error: "Must be a number" })
  .int("Must be an integer")
  .min(0, "Must be between 0 and 10000")
  .max(10000, "Must be between 0 and 10000");

export const createTradeSchema = z
  .object({
    sellerAddress: stellarPublicKey,
    amountUsdc: positiveAmountString,
    buyerLossBps: lossBps,
    sellerLossBps: lossBps,
    description: z.string().optional(),
  })
  .refine(
    (d) => d.buyerLossBps + d.sellerLossBps === 10000,
    {
      message: "buyerLossBps and sellerLossBps must sum to 10000",
      path: ["buyerLossBps"],
    },
  );

export const tradeIdParamSchema = z.object({
  id: z.string().min(1, "Trade ID is required"),
});

export const listTradesQuerySchema = z.object({
  status: z.nativeEnum(TradeStatus).optional(),
  page: z.preprocess((val: unknown) => val === undefined ? undefined : Number(val), z.number().int().min(1).default(1)),
  limit: z.preprocess((val: unknown) => val === undefined ? undefined : Number(val), z.number().int().min(1).max(100).default(20)),
  sort: z.string().optional(),
});

export const initiateDisputeSchema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
  category: z.string().min(1, "Category is required"),
});
