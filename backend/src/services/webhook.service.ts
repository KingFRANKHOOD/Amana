import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { TradeStatus } from "@prisma/client";

interface WebhookPayload {
  event: string;
  tradeId: string;
  status: TradeStatus;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;

  constructor() {
    this.webhookUrl = env.WEBHOOK_URL;
    this.webhookSecret = env.WEBHOOK_SECRET;
  }

  async dispatch(tradeId: string, status: TradeStatus, metadata: Record<string, unknown> = {}): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const payload: WebhookPayload = {
      event: `trade.${status.toLowerCase()}`,
      tradeId,
      status,
      timestamp: new Date().toISOString(),
      data: metadata,
    };

    const body = JSON.stringify(payload);
    const signature = this.webhookSecret
      ? crypto.createHmac("sha256", this.webhookSecret).update(body).digest("hex")
      : undefined;

    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-Webhook-Signature": signature } : {}),
        },
        body,
      });

      if (!response.ok) {
        appLogger.warn(
          { tradeId, status, statusCode: response.status },
          "Webhook dispatch returned non-OK status",
        );
      } else {
        appLogger.debug(
          { tradeId, status },
          "Webhook dispatched successfully",
        );
      }
    } catch (error) {
      appLogger.error(
        { error, tradeId, status },
        "Failed to dispatch webhook",
      );
    }
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}

export const webhookService = new WebhookService();
