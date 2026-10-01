import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { getMe, updateMe, getUserByAddress } from "../controllers/user.controller";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { createWalletRateLimiter } from "../lib/rateLimit";

const limiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.user);
const userAddressParamSchema = z.object({
  address: z.string().refine((value: string) => StrKey.isValidEd25519PublicKey(value), {
    message: "Invalid Stellar public key",
  }),
});

const router = Router();

router.use(limiter);

router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);
router.get("/:address", validateRequest({ params: userAddressParamSchema }), getUserByAddress);

export default router;
