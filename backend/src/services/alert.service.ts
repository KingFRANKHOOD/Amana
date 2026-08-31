import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";

export type AlertType =
  | "db_connection_failure"
  | "redis_connection_failure"
  | "cache_unavailable"
  | "pg_pool_saturation"
  | "webhook_delivery_failure";

export type AlertSeverity = "critical" | "warning";

export interface AlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

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
