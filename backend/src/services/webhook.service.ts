import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/db";
import { TradeStatus } from "@prisma/client";

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

export class WebhookService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly requestTimeoutMs = 10000;

  constructor() {
    this.webhookUrl = env.WEBHOOK_URL;
    this.webhookSecret = env.WEBHOOK_SECRET;
    this.maxAttempts = env.WEBHOOK_MAX_ATTEMPTS;
    this.retryBaseMs = env.WEBHOOK_RETRY_BASE_MS;
    this.retryMaxMs = env.WEBHOOK_RETRY_MAX_MS;
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
      secret: subscription.secretHash,
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

  private async sendWebhookWithRetry(
    target: DeliveryTarget,
    body: string,
    tradeId: string,
    status: TradeStatus,
  ): Promise<void> {
    let lastError: unknown = null;

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
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}

export const webhookService = new WebhookService();
