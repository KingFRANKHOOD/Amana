import { Response, NextFunction } from "express";
import { AuthService, AuthRequest } from "../services/auth.service";
import { isAppError } from "../errors/errorCodes";
import { AuthHelper } from "../lib/authHelper";

export { AuthRequest };

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Use centralized auth helper for proper error classification
  const { user, error } = await AuthHelper.authenticateRequest(
    req,
    AuthService.validateToken,
  );

  if (error) {
    // Recognise AppError structurally (not just via `instanceof`) so a failed
    // authorization preserves its real status code and message instead of being
    // collapsed into a generic 401 when the prototype chain doesn't line up.
    if (isAppError(error)) {
      res.status(error.statusCode).json({
        code: error.code,
        error: error.message,
        details: error.details,
      });
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = user;
  next();
};
