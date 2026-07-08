import { Response, NextFunction } from "express";
import { AuthRequest } from "../services/auth.service";
import { featureFlagService } from "../services/feature-flags.service";

/**
 * Gates a route behind a feature flag. Responds 503 when the flag resolves
 * to disabled for the requesting user, otherwise calls `next()`.
 */
export function requireFeature(name: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.sub ?? req.user?.walletAddress;
    const enabled = await featureFlagService.isEnabled(name, userId);

    if (!enabled) {
      res.status(503).json({
        code: "FEATURE_DISABLED",
        error: `Feature '${name}' is currently disabled`,
      });
      return;
    }

    next();
  };
}
