import { Router, Request, Response, NextFunction } from "express";
import { SavingsService } from "../services/savings.service";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { appLogger } from "../middleware/logger";

export function createGoalsRouter(): Router {
    const router = Router();
    const savingsService = new SavingsService();

    /**
     * GET /goals
     * Fetch goal analytics for authenticated user
     * Returns comprehensive goal mapping with percentage bounds and progression metrics
     */
    router.get(
        "/",
        authMiddleware,
        async (req: AuthRequest, res: Response, next: NextFunction) => {
            try {
                if (!req.user?.walletAddress) {
                    return res.status(401).json({ error: "Unauthorized" });
                }

                const analytics = await savingsService.getGoalsAnalytics(
                    req.user.walletAddress
                );

                appLogger.info(
                    { walletAddress: req.user.walletAddress, totalGoals: analytics.totalGoals },
                    "Goals analytics retrieved"
                );

                res.status(200).json(analytics);
            } catch (error) {
                appLogger.error({ error }, "Failed to fetch goals analytics");
                next(error);
            }
        }
    );

    return router;
}
