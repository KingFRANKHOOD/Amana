import Redis from "ioredis";
import { env } from "../config/env";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const isTestEnv = process.env.NODE_ENV === "test";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTestEnv,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});
