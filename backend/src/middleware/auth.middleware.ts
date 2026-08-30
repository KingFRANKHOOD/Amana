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
    // Bind so `this` inside the static method resolves to AuthService when
    // invoked as a bare function reference — otherwise `this.isTokenRevoked`
    // throws for every valid token (unbound static method reference).
    AuthService.validateToken.bind(AuthService),
  );

  if (error) {
    // Recognise AppError structurally (not just via `instanceof`) so a failed
    // authorization preserves its real status code and details instead of being
    // collapsed into a generic 401 when the prototype chain doesn't line up.
    if (isAppError(error)) {
      res.status(error.statusCode).json({
        code: error.code,
        error: error.message || "Unauthorized",
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
