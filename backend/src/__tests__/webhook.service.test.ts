import crypto from "crypto";
import { WebhookService, __resetConsecutiveFailureStateForTests } from "../services/webhook.service";
import { alertService } from "../services/alert.service";
import { __resetMetricsForTests } from "../lib/metrics";

jest.mock("../services/alert.service", () => ({
  alertService: {
    dispatch: jest.fn(),
  },
}));

jest.mock("../lib/db", () => ({
  prisma: {
    webhookSubscription: {
      findMany: jest.fn(),
    },
    webhookDeadLetter: {
      create: jest.fn(),
    },
  },
}));

const mockPrisma = require("../lib/db").prisma;

describe("WebhookService", () => {
  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetMetricsForTests();
    __resetConsecutiveFailureStateForTests();
    (alertService.dispatch as jest.Mock).mockResolvedValue(undefined);
    service = new WebhookService();
    (service as any).maxAttempts = 3;
    (service as any).retryBaseMs = 10;
    (service as any).retryMaxMs = 100;
    (service as any).consecutiveFailureThreshold = 5;
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("dispatch", () => {
    it("returns early when no subscriptions or env webhook are configured", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = undefined;

      await service.dispatch("trade-1", "CREATED");

      expect(mockPrisma.webhookSubscription.findMany).toHaveBeenCalled();
    });

    it("dispatches to active subscriptions matching the event", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        {
          id: 1,
          url: "https://example.com/hook",
          secretHash: "secret",
        },
      ]);
      (service as any).webhookUrl = undefined;

      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: true, status: 200 } as Response),
      );

      await service.dispatch("trade-1", "CREATED", { foo: "bar" });

      expect(fetch).toHaveBeenCalledWith(
        "https://example.com/hook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("sendWebhookWithRetry", () => {
    it("records success metrics on first successful attempt", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = "https://example.com/hook";

      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: true, status: 200 } as Response),
      );

      await service.dispatch("trade-1", "CREATED");

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries on 5xx and eventually records failure metrics", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = "https://example.com/hook";

      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: false, status: 500 } as Response),
      );

      await service.dispatch("trade-1", "CREATED");

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("moves permanently failed deliveries to dead letter", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = "https://example.com/hook";

      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: false, status: 500 } as Response),
      );

      await service.dispatch("trade-1", "CREATED");

      expect(mockPrisma.webhookDeadLetter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            webhookUrl: "https://example.com/hook",
            tradeId: "trade-1",
            attempts: 3,
          }),
        }),
      );
    });

    it("dispatches alert after consecutive failure threshold is reached", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = "https://example.com/hook";
      (service as any).consecutiveFailureThreshold = 2;

      global.fetch = jest.fn(() =>
        Promise.resolve({ ok: false, status: 500 } as Response),
      );

      await service.dispatch("trade-1", "CREATED");
      await service.dispatch("trade-2", "CREATED");

      expect(alertService.dispatch).toHaveBeenCalledWith(
        "webhook_delivery_failure",
        expect.stringContaining("https://example.com/hook"),
        expect.objectContaining({
          consecutiveFailures: 6,
        }),
        "critical",
      );
    });

    it("resets consecutive failures after a successful delivery", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      (service as any).webhookUrl = "https://example.com/hook";
      (service as any).consecutiveFailureThreshold = 2;

      global.fetch = jest
        .fn(() => Promise.resolve({ ok: false, status: 500 } as Response))
        .mockImplementationOnce(() =>
          Promise.resolve({ ok: true, status: 200 } as Response),
        );

      await service.dispatch("trade-1", "CREATED");
      await service.dispatch("trade-2", "CREATED");

      expect(alertService.dispatch).not.toHaveBeenCalled();
    });
  });
});
