import { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { appLogger } from "./logger";

const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24 hours
const IDEMPOTENCY_LOCK_TTL = 30; // 30 seconds
const IN_PROGRESS_POLL_MS = 25;
const IN_PROGRESS_MAX_POLLS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCachedResponse(cacheKey: string): Promise<string | null> {
  for (let i = 0; i < IN_PROGRESS_MAX_POLLS; i += 1) {
    await sleep(IN_PROGRESS_POLL_MS);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  return null;
}

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
  const lockKey = `idempotency:lock:${req.path}:${key}`;

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

    const lock = await redis.set(lockKey, "1", "NX", "EX", IDEMPOTENCY_LOCK_TTL);

    if (lock !== "OK") {
      const replayResponse = await waitForCachedResponse(cacheKey);
      if (replayResponse) {
        appLogger.info({ key, path: req.path }, "Idempotency replay after in-flight request");
        const { status, body, headers } = JSON.parse(replayResponse);

        Object.entries(headers).forEach(([k, v]) => {
          res.setHeader(k, v as string);
        });
        res.setHeader("X-Idempotency-Cache", "HIT");

        return res.status(status).json(body);
      }

      res.setHeader("X-Idempotency-Cache", "IN_PROGRESS");
      return res.status(409).json({
        error: "Request with this idempotency key is already in progress",
      });
    }

    let lockReleased = false;
    const releaseLock = () => {
      if (lockReleased) {
        return;
      }
      lockReleased = true;
      redis.del(lockKey).catch((err) =>
        appLogger.error({ err, key }, "Failed to release idempotency lock"),
      );
    };

    res.once("finish", releaseLock);
    res.once("close", releaseLock);

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
