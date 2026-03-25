import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { getMe, updateMe, getUserByAddress } from "../controllers/user.controller";

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.use(limiter);

router.get("/me", requireAuth, getMe);
router.put("/me", requireAuth, updateMe);
router.get("/:address", getUserByAddress);

export default router;
