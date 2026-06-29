import { z } from "zod";

export const addNoteSchema = z.object({
  content: z
    .string()
    .min(1, "Note content is required")
    .max(2000, "Note content must be 2000 characters or fewer"),
});

export const tradeIdParamSchema = z.object({
  id: z.string().min(1, "Trade ID is required"),
});
