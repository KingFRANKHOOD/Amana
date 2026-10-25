import crypto from "crypto";
import { AlertService } from "../services/alert.service";

jest.mock("../middleware/logger", () => ({
  appLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("AlertService", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("does not dispatch when webhook URL is unset", async () => {
    const service = new AlertService(undefined, undefined, 1000);

    await service.dispatch("db_connection_failure", "Database down");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.isConfigured()).toBe(false);
  });

  it("dispatches alert payload with HMAC signature", async () => {
    const service = new AlertService(
      "https://alerts.example.com/hook",
      "test-secret",
      1000,
    );

    await service.dispatch("redis_connection_failure", "Redis unavailable", {
      responseTime: 42,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://alerts.example.com/hook");
    expect(options.method).toBe("POST");

    const body = options.body as string;
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      type: "redis_connection_failure",
      severity: "critical",
      message: "Redis unavailable",
      details: { responseTime: 42 },
    });

    const expectedSignature = crypto
      .createHmac("sha256", "test-secret")
      .update(body)
      .digest("hex");
    expect(options.headers["X-Alert-Signature"]).toBe(expectedSignature);
  });

  it("suppresses duplicate alerts within cooldown window", async () => {
    const service = new AlertService("https://alerts.example.com/hook", undefined, 60_000);

    await service.dispatch("cache_unavailable", "Cache down");
    await service.dispatch("cache_unavailable", "Cache down again");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows alert after cooldown reset", async () => {
    const service = new AlertService("https://alerts.example.com/hook", undefined, 60_000);

    await service.dispatch("db_connection_failure", "Database down");
    service.resetCooldown("db_connection_failure");
    await service.dispatch("db_connection_failure", "Database down again");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("logs and does not throw when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const service = new AlertService("https://alerts.example.com/hook", undefined, 1000);

    await expect(
      service.dispatch("db_connection_failure", "Database down"),
    ).resolves.toBeUndefined();
  });

  it("does not update cooldown when webhook returns non-OK status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const service = new AlertService("https://alerts.example.com/hook", undefined, 60_000);

    await service.dispatch("db_connection_failure", "Database down");
    await service.dispatch("db_connection_failure", "Database down again");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dispatches webhook delivery failure alert", async () => {
    const service = new AlertService("https://alerts.example.com/hook", "secret", 1000);

    await service.dispatch("webhook_delivery_failure", "Webhook failing", {
      webhookUrl: "https://example.com/hook",
      consecutiveFailures: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as string;
    const payload = JSON.parse(body);
    expect(payload.type).toBe("webhook_delivery_failure");
    expect(payload.details.webhookUrl).toBe("https://example.com/hook");
  });
});
