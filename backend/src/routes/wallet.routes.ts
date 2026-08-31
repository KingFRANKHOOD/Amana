import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middleware/auth.middleware";
import { WalletService } from "../services/wallet.service";
import { PathPaymentService } from "../services/pathPayment.service";
import { TOKEN_CONFIG } from "../config/token";

export const walletRoutes = Router();
const walletService = new WalletService();
const pathPaymentService = new PathPaymentService();

const pathPaymentQuoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many quote requests, please try again later" },
});

const pathPaymentQuoteQuerySchema = z.object({
  sourceAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "sourceAmount must be a positive decimal number")
    .refine((v) => Number(v) > 0, "sourceAmount must be greater than 0"),
  sourceAsset: z
    .string()
    .regex(/^[A-Za-z0-9]{1,12}$/, "sourceAsset must be a valid asset code"),
  sourceAssetIssuer: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, "sourceAssetIssuer must be a valid Stellar public key")
    .optional(),
});

walletRoutes.get("/balance", authMiddleware, async (req: any, res) => {
  try {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address not found in token" });
    }
    const balance = await walletService.getUsdcBalance(walletAddress);
    res.json({ balance, asset: TOKEN_CONFIG.symbol });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});


walletRoutes.get(
  "/path-payment-quote",
  authMiddleware,
  pathPaymentQuoteLimiter,
  async (req, res) => {
    const parsed = pathPaymentQuoteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { sourceAmount, sourceAsset, sourceAssetIssuer } = parsed.data;

    try {
      const quotes = await pathPaymentService.getPathPaymentQuote(
        sourceAmount,
        sourceAsset,
        sourceAssetIssuer as string
      );
      res.json({ routes: quotes });
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.status === 404) {
        return res.status(404).json({ error: "No payment path found" });
      }
      if (error?.isAxiosError || error?.response) {
        return res.status(502).json({ error: "Upstream payment provider error" });
      }
      res.status(503).json({ error: "Failed to fetch quotes" });
    }
  }
);
