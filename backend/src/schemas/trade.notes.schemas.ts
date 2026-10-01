import { z } from "zod";

const noUnsafeHtml = (value: string) => !/[<>]/.test(value) && !/(?:on\w+\s*=|javascript:|data:text\/html)/i.test(value);

export const addNoteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note content is required")
    .max(2000, "Note content must be 2000 characters or fewer")
    .refine(noUnsafeHtml, "Note content contains unsupported HTML or script content"),
});

export const tradeIdParamSchema = z.object({
  id: z.string().min(1, "Trade ID is required"),
});
