import { Response, NextFunction } from "express";
import { isMediatorAddress } from "../lib/accessControl";
import { AuthRequest } from "../services/auth.service";

export const adminMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress || !isMediatorAddress(walletAddress)) {
    res.status(403).json({ error: "Forbidden: admin access required" });
    return;
  }
  next();
};
