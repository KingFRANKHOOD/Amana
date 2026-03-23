import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      userAddress?: string;
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const walletAddress = req.headers["x-wallet-address"];

  if (!walletAddress || typeof walletAddress !== "string") {
    res.status(401).json({ error: "Missing or invalid x-wallet-address header" });
    return;
  }

  req.userAddress = walletAddress;
  next();
}
