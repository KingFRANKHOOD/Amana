import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

const stellarPublicKey = z.string().refine(StrKey.isValidEd25519PublicKey, {
  message: "Invalid Stellar public key for sellerAddress",
});

const amountUsdc = z.union([
  z.string().regex(/^\d+(\.\d{1,7})?$/, "Invalid amount format"),
  z.number().positive("Amount must be positive").transform(String),
]);

export const createTradeTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required").max(100),
    sellerAddress: stellarPublicKey,
    amountUsdc,
    buyerLossBps: z.number().int().min(0).max(10000).default(5000),
    sellerLossBps: z.number().int().min(0).max(10000).default(5000),
  })
  .superRefine(
    (value: { buyerLossBps: number; sellerLossBps: number }, ctx: any) => {
      if (value.buyerLossBps + value.sellerLossBps !== 10000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buyerLossBps"],
          message: "sum of buyerLossBps and sellerLossBps must equal 10000",
        });
      }
    },
  );

export const templateIdParamSchema = z.object({
  templateId: z.coerce.number().int().positive(),
});

/** Maximum items that can be returned in a single page for list endpoints. */
export const TEMPLATE_LIST_MAX_LIMIT = 100;

export const listTemplatesQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Number(v)),
    z.number().int().min(1).default(1),
  ),
  limit: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Number(v)),
    z.number().int().min(1).max(TEMPLATE_LIST_MAX_LIMIT).default(20),
  ),
});
