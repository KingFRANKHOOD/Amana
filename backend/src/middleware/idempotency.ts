import { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { appLogger } from "./logger";

const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24 hours

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const key = req.headers["idempotency-key"] as string;

  if (!key) {
    return next();
  }

  // Only apply to mutations (POST, PUT, PATCH, DELETE)
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const cacheKey = `idempotency:${req.path}:${key}`;

  try {
    const cachedResponse = await redis.get(cacheKey);

    if (cachedResponse) {
      appLogger.info({ key, path: req.path }, "Idempotency cache hit");
      const { status, body, headers } = JSON.parse(cachedResponse);
      
      // Set cached headers
      Object.entries(headers).forEach(([k, v]) => {
        res.setHeader(k, v as string);
      });
      res.setHeader("X-Idempotency-Cache", "HIT");
      
      return res.status(status).json(body);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only cache successful or specific error responses if needed
      // For now, we cache everything to be strictly idempotent
      if (res.statusCode < 500) {
        const responseData = {
          status: res.statusCode,
          body,
          headers: res.getHeaders(),
        };
        redis.set(cacheKey, JSON.stringify(responseData), "EX", IDEMPOTENCY_TTL)
          .catch(err => appLogger.error({ err }, "Failed to cache idempotent response"));
      }
      
      return originalJson(body);
    };

    next();
  } catch (error) {
    appLogger.error({ error, key }, "Idempotency middleware error");
    next(); // Proceed without idempotency if Redis fails
  }
};
