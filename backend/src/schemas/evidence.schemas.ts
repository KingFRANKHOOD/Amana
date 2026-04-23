import { z } from "zod";

export const uploadEvidenceSchema = z.object({
  tradeId: z.string().uuid("Invalid trade ID format"),
});

export const streamEvidenceParamSchema = z.object({
  cid: z.string().min(1, "CID is required"),
});
