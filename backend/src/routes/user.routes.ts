import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { getMe, updateMe, getUserByAddress } from "../controllers/user.controller";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { createWalletRateLimiter } from "../lib/rateLimit";

const limiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.user);

const router = Router();

router.use(limiter);

router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);
router.get("/:address", getUserByAddress);

export default router;
