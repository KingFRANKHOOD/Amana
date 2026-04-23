import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
};
