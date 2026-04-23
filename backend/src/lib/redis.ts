import Redis from "ioredis";
import { env } from "../config/env";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});
