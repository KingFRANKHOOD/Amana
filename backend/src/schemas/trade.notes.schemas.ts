import { z } from "zod";
import { strictTradeIdSchema } from "./trade.schemas";

export const addNoteSchema = z.object({
  content: z
    .string()
    .min(1, "Note content is required")
    .max(2000, "Note content must be 2000 characters or fewer"),
});

export const tradeIdParamSchema = z.object({
  id: strictTradeIdSchema,
});
