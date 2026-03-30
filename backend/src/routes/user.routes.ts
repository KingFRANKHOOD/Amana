import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middleware/auth.middleware";
import { getMe, updateMe, getUserByAddress } from "../controllers/user.controller";

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.use(limiter);

router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);
router.get("/:address", getUserByAddress);

export default router;
