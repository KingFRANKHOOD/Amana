import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/db";
import { TradeStatus } from "@prisma/client";
import { EncryptionService } from "./encryption.service";
import { alertService } from "./alert.service";
import {
  recordWebhookDelivery,
  recordWebhookDeadLetter,
  recordWebhookConsecutiveFailures,
} from "../lib/metrics";

const WEBHOOK_SECRET_CONTEXT = "webhook-secret";

interface WebhookPayload {
  event: string;
  tradeId: string;
  status: TradeStatus;
  timestamp: string;
  data: Record<string, unknown>;
}

interface DeliveryTarget {
  url: string;
  secret?: string;
  subscriptionId?: number | null;
}

interface DeliveryState {
  target: DeliveryTarget;
  consecutiveFailures: number;
}

const consecutiveFailureState = new Map<string, DeliveryState>();

export class WebhookService {
  private readonly encryptionService: EncryptionService;
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly requestTimeoutMs = 10000;
  private readonly consecutiveFailureThreshold: number;

  constructor() {
    this.encryptionService = new EncryptionService();
    this.webhookUrl = env.WEBHOOK_URL;
    this.webhookSecret = env.WEBHOOK_SECRET;
    this.maxAttempts = env.WEBHOOK_MAX_ATTEMPTS;
    this.retryBaseMs = env.WEBHOOK_RETRY_BASE_MS;
    this.retryMaxMs = env.WEBHOOK_RETRY_MAX_MS;
    this.consecutiveFailureThreshold = env.WEBHOOK_CONSECUTIVE_FAILURE_THRESHOLD;
  }

  async dispatch(tradeId: string, status: TradeStatus, metadata: Record<string, unknown> = {}): Promise<void> {
    const event = `trade.${status.toLowerCase()}`;
    const activeSubscriptions = await prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
      select: {
        id: true,
        url: true,
        secretHash: true,
      },
    });

    const deliveryTargets: DeliveryTarget[] = activeSubscriptions.map((subscription) => ({
      url: subscription.url,
      secret: this.decryptSubscriptionSecret(subscription.secretHash),
      subscriptionId: subscription.id,
    }));

    if (this.webhookUrl) {
      deliveryTargets.push({
        url: this.webhookUrl,
        secret: this.webhookSecret,
        subscriptionId: null,
      });
    }

    if (deliveryTargets.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      event,
      tradeId,
      status,
      timestamp: new Date().toISOString(),
      data: metadata,
    };

    const body = JSON.stringify(payload);

    await Promise.allSettled(
      deliveryTargets.map((target) => this.sendWebhookWithRetry(target, body, tradeId, status)),
    );
  }

  private decryptSubscriptionSecret(secretHash: string | null | undefined): string | undefined {
    if (!secretHash) return undefined;
    try {
      return this.encryptionService.decrypt(secretHash, WEBHOOK_SECRET_CONTEXT);
    } catch (error) {
      appLogger.warn({ error }, "Failed to decrypt webhook subscription secret");
      return undefined;
    }
  }

  private async sendWebhookWithRetry(
    target: DeliveryTarget,
    body: string,
    tradeId: string,
    status: TradeStatus,
  ): Promise<void> {
    const start = performance.now();
    let lastError: unknown = null;
    const stateKey = target.url;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const signature = target.secret
          ? crypto.createHmac("sha256", target.secret).update(body).digest("hex")
          : undefined;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let response: Response;
        try {
          response = await fetch(target.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(signature ? { "X-Webhook-Signature": signature } : {}),
            },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.ok) {
          appLogger.debug(
            {
              tradeId,
              status,
              webhookUrl: target.url,
              subscriptionId: target.subscriptionId,
              attempt,
            },
            "Webhook dispatched successfully",
          );

          const durationMs = performance.now() - start;
          recordWebhookDelivery("success", durationMs, {
            webhook_url: target.url,
            subscription_id: target.subscriptionId ?? "system",
            event: `trade.${status.toLowerCase()}`,
          });

          consecutiveFailureState.delete(stateKey);
          return;
        }

        const shouldRetry = response.status >= 500 || response.status === 429;
        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            statusCode: response.status,
            attempt,
            shouldRetry,
          },
          "Webhook delivery returned non-OK status",
        );

        if (!shouldRetry || attempt === this.maxAttempts) {
          const durationMs = performance.now() - start;
          recordWebhookDelivery("failure", durationMs, {
            webhook_url: target.url,
            subscription_id: target.subscriptionId ?? "system",
            event: `trade.${status.toLowerCase()}`,
            status_code: response.status,
          });
          this.incrementConsecutiveFailures(stateKey, target, tradeId, status);
          return;
        }
      } catch (error) {
        lastError = error;
        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            attempt,
            error,
          },
          "Webhook delivery attempt failed",
        );
      }

      if (attempt < this.maxAttempts) {
        const delay = Math.min(this.retryBaseMs * 2 ** (attempt - 1), this.retryMaxMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const durationMs = performance.now() - start;
    recordWebhookDelivery("failure", durationMs, {
      webhook_url: target.url,
      subscription_id: target.subscriptionId ?? "system",
      event: `trade.${status.toLowerCase()}`,
    });

    appLogger.error(
      {
        tradeId,
        status,
        webhookUrl: target.url,
        subscriptionId: target.subscriptionId,
        error: lastError,
      },
      "Webhook delivery failed after retries",
    );

    this.incrementConsecutiveFailures(stateKey, target, tradeId, status, lastError);
    await this.moveToDeadLetter(target, body, tradeId, status, lastError);
  }

  private incrementConsecutiveFailures(
    stateKey: string,
    target: DeliveryTarget,
    tradeId: string,
    status: TradeStatus,
    error?: unknown,
  ): void {
    const current = consecutiveFailureState.get(stateKey);
    const nextCount = (current?.consecutiveFailures ?? 0) + 1;
    consecutiveFailureState.set(stateKey, {
      target,
      consecutiveFailures: nextCount,
    });

    recordWebhookConsecutiveFailures({
      webhook_url: target.url,
      subscription_id: target.subscriptionId ?? "system",
      event: `trade.${status.toLowerCase()}`,
    });

    if (nextCount >= this.consecutiveFailureThreshold) {
      appLogger.error(
        {
          tradeId,
          status,
          webhookUrl: target.url,
          subscriptionId: target.subscriptionId,
          consecutiveFailures: nextCount,
          error,
        },
        "Webhook target has exceeded consecutive failure threshold",
      );

      alertService
        .dispatch(
          "webhook_delivery_failure",
          `Webhook delivery to ${target.url} has failed ${nextCount} consecutive times for trade ${tradeId}`,
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            consecutiveFailures: nextCount,
            event: `trade.${status.toLowerCase()}`,
            lastError: error instanceof Error ? error.message : String(error),
          },
          "critical",
        )
        .catch((dispatchError) => {
          appLogger.error(
            { dispatchError, webhookUrl: target.url },
            "Failed to dispatch webhook failure alert",
          );
        });
    }
  }

  private async moveToDeadLetter(
    target: DeliveryTarget,
    body: string,
    tradeId: string,
    status: TradeStatus,
    error: unknown,
  ): Promise<void> {
    try {
      await prisma.webhookDeadLetter.create({
        data: {
          webhookUrl: target.url,
          subscriptionId: target.subscriptionId ?? undefined,
          secretHash: target.secret ?? undefined,
          event: `trade.${status.toLowerCase()}`,
          tradeId,
          status: error instanceof Error ? error.message : String(error),
          payload: JSON.parse(body),
          lastError: error instanceof Error ? error.message : String(error),
          attempts: this.maxAttempts,
        },
      });

      recordWebhookDeadLetter({
        webhook_url: target.url,
        subscription_id: target.subscriptionId ?? "system",
        event: `trade.${status.toLowerCase()}`,
      });
    } catch (deadLetterError) {
      appLogger.error(
        { deadLetterError, webhookUrl: target.url, tradeId },
        "Failed to persist webhook dead-letter record",
      );
    }
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}

export const webhookService = new WebhookService();

/** Vitest/Jest-only hook to clear consecutive failure state between tests. */
export function __resetConsecutiveFailureStateForTests(): void {
  consecutiveFailureState.clear();
}
