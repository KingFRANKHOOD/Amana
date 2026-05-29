import Redis from "ioredis";
import { EventEmitter } from "events";
import { env } from "../config/env";

const REDIS_URL = process.env.REDIS_URL ?? env.REDIS_URL;
const isTestEnv = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";

// ioredis supports Redis URL strings at runtime, but TS 5.9 overload resolution does not match
// the (path: string, options: RedisOptions) constructor when options is an object literal.
// @ts-expect-error - ioredis URL+options constructor works at runtime
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTestEnv,
});

// ioredis Redis class extends EventEmitter at runtime; the .d.ts implements it via DataHandledable
(redis as unknown as EventEmitter).on("error", (err: Error) => {
  console.error("Redis error:", err);
});
