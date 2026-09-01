import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";

export type AlertType =
  | "db_connection_failure"
  | "redis_connection_failure"
  | "redis_memory_high"
  | "redis_evictions"
  | "cache_unavailable"
  | "pg_pool_saturation"
  | "slow_endpoint_detected"
  | "stellar_connection_failure"
  | "stellar_rpc_unavailable"
  | "stellar_rpc_failover"
  | "stellar_tx_rate_drop"
  | "webhook_delivery_failure";

export type AlertSeverity = "critical" | "warning";

export interface AlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

const REDIS_MEMORY_ALERT_THRESHOLD_PERCENT = 80;
const REDIS_MAXMEMORY_POLICY = "allkeys-lru";

export class AlertService {
  private readonly alertWebhookUrl: string | undefined;
  private readonly alertWebhookSecret: string | undefined;
  private readonly cooldownMs: number;
  private readonly lastSentAt = new Map<AlertType, number>();

  constructor(
    alertWebhookUrl: string | undefined = env.ALERT_WEBHOOK_URL,
    alertWebhookSecret: string | undefined = env.ALERT_WEBHOOK_SECRET,
    cooldownMs: number = env.ALERT_COOLDOWN_MS,
  ) {
    this.alertWebhookUrl = alertWebhookUrl;
    this.alertWebhookSecret = alertWebhookSecret;
    this.cooldownMs = cooldownMs;
  }

  async dispatch(
    type: AlertType,
    message: string,
    details: Record<string, unknown> = {},
    severity: AlertSeverity = "critical",
  ): Promise<void> {
    if (!this.alertWebhookUrl) {
      return;
    }

    const now = Date.now();
    const lastSent = this.lastSentAt.get(type);
    if (lastSent !== undefined && now - lastSent < this.cooldownMs) {
      appLogger.debug({ type }, "Alert suppressed by cooldown");
      return;
    }

    const payload: AlertPayload = {
      type,
      severity,
      timestamp: new Date().toISOString(),
      message,
      details,
    };

    const body = JSON.stringify(payload);
    const signature = this.alertWebhookSecret
      ? crypto.createHmac("sha256", this.alertWebhookSecret).update(body).digest("hex")
      : undefined;

    try {
      const response = await fetch(this.alertWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-Alert-Signature": signature } : {}),
        },
        body,
      });

      if (!response.ok) {
        appLogger.warn(
          { type, statusCode: response.status },
          "Alert dispatch returned non-OK status",
        );
        return;
      }

      this.lastSentAt.set(type, now);
      appLogger.info({ type }, "Alert dispatched successfully");
    } catch (error) {
      appLogger.error({ error, type }, "Failed to dispatch alert");
    }
  }

  async dispatchPoolSaturation(
    activeConnections: number,
    maxConnections: number,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const percentage = Math.round((activeConnections / maxConnections) * 100);
    const message = `PostgreSQL connection pool saturation: ${activeConnections}/${maxConnections} connections in use (${percentage}%)`;
    await this.dispatch("pg_pool_saturation", message, {
      activeConnections,
      maxConnections,
      poolUsagePercent: percentage,
      ...details,
    }, "warning");
  }

  async dispatchSlowEndpoint(
    endpoint: string,
    method: string,
    durationMs: number,
    thresholdMs: number = 2000,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `Slow API endpoint detected: ${method} ${endpoint} took ${durationMs.toFixed(2)}ms (threshold: ${thresholdMs}ms)`;
    await this.dispatch("slow_endpoint_detected", message, {
      endpoint,
      method,
      durationMs,
      thresholdMs,
      ...details,
    }, "warning");
  }

  async dispatchRedisMemoryHigh(
    usedMemoryBytes: number,
    maxMemoryBytes: number,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const usagePercent = Math.round((usedMemoryBytes / maxMemoryBytes) * 100);
    const message = `Redis memory usage is high: ${usagePercent}% used (${usedMemoryBytes}/${maxMemoryBytes} bytes)`;
    await this.dispatch("redis_memory_high", message, {
      usedMemoryBytes,
      maxMemoryBytes,
      usagePercent,
      ...details,
    }, "warning");
  }

  async dispatchRedisEvictions(
    evictedKeys: number,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `Redis evictions detected: ${evictedKeys} keys evicted`;
    await this.dispatch("redis_evictions", message, {
      evictedKeys,
      ...details,
    }, "critical");
  }

  async dispatchStellarConnectionFailure(
    endpoint: string,
    errorMessage: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `Stellar connectivity failure: Unable to connect to endpoint ${endpoint} (${errorMessage})`;
    await this.dispatch("stellar_connection_failure", message, {
      endpoint,
      errorMessage,
      environment: env.NODE_ENV,
      network: env.STELLAR_NETWORK,
      ...details,
    }, "critical");
  }

  private parseInfoValue(info: string, key: string): number | string | null {
    const pattern = new RegExp(`${key}:([^\\r]+)`, "m");
    const match = info.match(pattern);
    if (!match) return null;
    const value = match[1].trim();
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  }

  private async getRedisConfig(redis: any, parameter: string): Promise<string | null> {
    try {
      const result = await redis.config("GET", parameter);
      return result?.[1] ?? null;
    } catch (error) {
      appLogger.error({ error, parameter }, "Failed to read Redis config");
      return null;
    }
  }

  private async setRedisConfig(redis: any, parameter: string, value: string): Promise<boolean> {
    try {
      await redis.config("SET", parameter, value);
      appLogger.info({ parameter, value }, "Redis config updated");
      return true;
    } catch (error) {
      appLogger.error({ error, parameter, value }, "Failed to update Redis config");
      return false;
    }
  }

  async monitorRedis(redis: any): Promise<void> {
    try {
      const memoryInfo = await redis.info("memory");
      const statsInfo = await redis.info("stats");
      const usedMemory = Number(this.parseInfoValue(memoryInfo, "used_memory") ?? 0);
      const maxMemory = Number(this.parseInfoValue(memoryInfo, "maxmemory") ?? 0);
      const maxMemoryPolicy = await this.getRedisConfig(redis, "maxmemory-policy");
      const evictedKeys = Number(this.parseInfoValue(statsInfo, "evicted_keys") ?? 0);

      if (maxMemoryPolicy && maxMemoryPolicy !== REDIS_MAXMEMORY_POLICY) {
        appLogger.warn({ maxMemoryPolicy, expected: REDIS_MAXMEMORY_POLICY }, "Redis maxmemory-policy differs from recommended configuration");
        // Attempt to apply recommended configuration
        await this.setRedisConfig(redis, "maxmemory-policy", REDIS_MAXMEMORY_POLICY);
      }

      if (usedMemory > 0 && maxMemory > 0) {
        const usagePercent = (usedMemory / maxMemory) * 100;
        if (usagePercent >= REDIS_MEMORY_ALERT_THRESHOLD_PERCENT) {
          await this.dispatchRedisMemoryHigh(usedMemory, maxMemory, {
            maxMemoryPolicy,
            evictedKeys,
          });
        }
      } else {
        appLogger.debug(
          { usedMemory, maxMemory },
          "Redis maxmemory is not configured; monitoring used_memory absolute growth",
        );
      }

      if (evictedKeys > 0) {
        await this.dispatchRedisEvictions(evictedKeys, {
          usedMemory,
          maxMemory,
          maxMemoryPolicy,
        });
      }
    } catch (error) {
      appLogger.error({ error }, "Failed to monitor Redis");
    }
  }

  async getRedisHealth(redis: any): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await redis.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      appLogger.error({ error }, "Redis health check failed");
      return { healthy: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async dispatchStellarRpcFailover(
    fromEndpoint: string,
    toEndpoint: string,
    reason: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `Stellar RPC failover triggered: Switched from ${fromEndpoint} to ${toEndpoint} (${reason})`;
    await this.dispatch("stellar_rpc_failover", message, {
      fromEndpoint,
      toEndpoint,
      reason,
      environment: env.NODE_ENV,
      network: env.STELLAR_NETWORK,
      ...details,
    }, "warning");
  }

  async dispatchStellarTxRateDrop(
    successRate: number,
    failureRate: number,
    totalSubmissions: number,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const message = `Stellar transaction success rate dropped to ${(successRate * 100).toFixed(1)}% (failures: ${(failureRate * 100).toFixed(1)}% over ${totalSubmissions} submissions)`;
    await this.dispatch("stellar_tx_rate_drop", message, {
      successRate,
      failureRate,
      totalSubmissions,
      environment: env.NODE_ENV,
      network: env.STELLAR_NETWORK,
      ...details,
    }, "critical");
  }

  isConfigured(): boolean {
    return !!this.alertWebhookUrl;
  }

  resetCooldown(type?: AlertType): void {
    if (type) {
      this.lastSentAt.delete(type);
      return;
    }
    this.lastSentAt.clear();
  }
}

export const alertService = new AlertService();
