import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { featureFlagService } from "../services/feature-flags.service";

const updateFlagBodySchema = z.object({
  enabled: z.boolean(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
});

export function createAdminFeaturesRouter() {
  const router = Router();

  router.get(
    "/admin/features",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response, next) => {
      try {
        const flags = await featureFlagService.listFlags();
        res.status(200).json({ flags });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/admin/features/:name",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: updateFlagBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const name = String(req.params.name);
        const { enabled, rolloutPercentage } = req.body as {
          enabled: boolean;
          rolloutPercentage?: number;
        };

        const flag = await featureFlagService.setFlag(name, { enabled, rolloutPercentage });
        res.status(200).json({ name, flag });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
