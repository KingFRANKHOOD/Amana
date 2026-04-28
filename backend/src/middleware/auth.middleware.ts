import { Response, NextFunction } from "express";
import { AuthService, AuthRequest } from "../services/auth.service";
import { AppError } from "../errors/errorCodes";

export { AuthRequest };

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
    const decoded = await AuthService.validateToken(token);

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  }
};

