import { Response, NextFunction } from "express";
import { AuthService, AuthRequest } from "../services/auth.service";
import { isAppError } from "../errors/errorCodes";

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
    // Recognise AppError structurally (not just via `instanceof`) so a failed
    // authorization preserves its real status code and message instead of being
    // collapsed into a generic 401 when the prototype chain doesn't line up.
    if (isAppError(error)) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  }
};

