import Redis from "ioredis";
import { EventEmitter } from "events";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { alertService } from "../services/alert.service";

const REDIS_URL = process.env.REDIS_URL ?? env.REDIS_URL;
const isTestEnv = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTestEnv,
});

function dispatchRedisAlert(message: string, details: Record<string, unknown> = {}): void {
  void alertService.dispatch("redis_connection_failure", message, details);
}

const MEMORY_ALERT_THRESHOLD = 0.8;
const MONITOR_INTERVAL_MS = 30_000;
let lastEvictedKeys = 0;
let memoryMonitoringStarted = false;

function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = info.split("\r\n");
  for (const line of lines) {
    if (line && !line.startsWith("#")) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        result[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
  }
  return result;
}

async function monitorRedisMemory(): Promise<void> {
  try {
    const info = await redis.info();
    const parsed = parseRedisInfo(info);

    const usedMemory = parseInt(parsed.used_memory ?? "0", 10);
    const maxMemory = parseInt(parsed.maxmemory ?? "0", 10);

    if (maxMemory > 0 && usedMemory / maxMemory >= MEMORY_ALERT_THRESHOLD) {
      dispatchRedisAlert("Redis memory usage exceeded 80%", {
        used_memory: usedMemory,
        maxmemory: maxMemory,
        usage_percent: Math.round((usedMemory / maxMemory) * 100),
      });
    }

    const evictedKeys = parseInt(parsed.evicted_keys ?? "0", 10);
    if (evictedKeys > lastEvictedKeys) {
      dispatchRedisAlert("Redis evictions detected", {
        evicted_keys: evictedKeys,
        delta: evictedKeys - lastEvictedKeys,
      });
      lastEvictedKeys = evictedKeys;
    }
  } catch (err) {
    appLogger.error({ error: err }, "Failed to monitor Redis memory");
  }
}

function startRedisMonitoring(): void {
  if (!isTestEnv && !memoryMonitoringStarted) {
    redis.config("SET", "maxmemory-policy", "allkeys-lru").catch((err) => {
      appLogger.error({ error: err }, "Failed to set Redis maxmemory-policy");
    });

    const interval = setInterval(monitorRedisMemory, MONITOR_INTERVAL_MS);
    interval.unref();
    memoryMonitoringStarted = true;
  }
}

export async function getRedisHealth(): Promise<{ status: string; latencyMs?: number; message?: string }> {
  try {
    const start = Date.now();
    await redis.ping();
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}

if (typeof (redis as any).on === "function") {
  (redis as unknown as EventEmitter).on("error", (err: Error) => {
    appLogger.error({ error: err }, "Redis error");
    dispatchRedisAlert("Redis client error", { error: err.message });
  });

  (redis as unknown as EventEmitter).on("close", () => {
    appLogger.warn("Redis connection closed");
    dispatchRedisAlert("Redis connection closed");
  });

  (redis as unknown as EventEmitter).on("ready", () => {
    startRedisMonitoring();
    redis.info().then((info) => {
      const parsed = parseRedisInfo(info);
      lastEvictedKeys = parseInt(parsed.evicted_keys ?? "0", 10);
    }).catch(() => {});
  });
}
