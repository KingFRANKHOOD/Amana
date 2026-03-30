import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthService } from "../services/auth.service";

export interface AuthRequest extends Request {
  user?: {
    walletAddress: string;
    jti?: string;
    [key: string]: any;
  };
}

const EXPECTED_ISSUER = process.env.JWT_ISSUER || 'amana';
const EXPECTED_AUDIENCE = process.env.JWT_AUDIENCE || 'amana-api';

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = authHeader.split(" ")[1];

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(401).json({ error: "Server configuration error" });
      return;
    }

    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
    }) as jwt.JwtPayload;

    // Enforce required claims
    if (!decoded.jti) {
      res.status(401).json({ error: "Unauthorized: missing jti claim" });
      return;
    }
    if (!decoded.nbf || decoded.nbf > Math.floor(Date.now() / 1000)) {
      res.status(401).json({ error: "Unauthorized: token not yet valid" });
      return;
    }

    // Check revocation denylist
    if (await AuthService.isTokenRevoked(decoded.jti)) {
      res.status(401).json({ error: "Unauthorized: token has been revoked" });
      return;
    }

    req.user = decoded as any;
    next();
  } catch (error) {
    res.status(401).json({ error: "Unauthorized" });
  }
};
