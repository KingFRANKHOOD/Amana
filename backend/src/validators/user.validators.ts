import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(32, "Display name must be 32 characters or fewer")
    .regex(/^[a-zA-Z0-9 _-]+$/, "Display name contains invalid characters")
    .optional(),
  avatarUrl: z.string().url("Invalid URL").optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
