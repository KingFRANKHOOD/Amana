import { AnalyticsService, AnalyticsEventName } from "../analytics.service";
import { appLogger } from "../../middleware/logger";

jest.mock("../../middleware/logger", () => ({
  appLogger: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockLogger = appLogger as unknown as { info: jest.Mock; warn: jest.Mock };

// Subclass that lets tests control the DB persistence path
class TestAnalyticsService extends AnalyticsService {
  persistResult: Promise<void> = Promise.resolve();
  persistCalled = false;

  protected async persistEvent(): Promise<void> {
    this.persistCalled = true;
    return this.persistResult;
  }
}

describe("AnalyticsService", () => {
  let service: TestAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestAnalyticsService();
  });

  const allEvents: AnalyticsEventName[] = [
    "trade.created",
    "trade.funded",
    "trade.confirmed",
    "trade.disputed",
    "trade.resolved",
    "trade.cancelled",
    "user.registered",
    "user.connected_wallet",
  ];

  it.each(allEvents)("emits %s via appLogger.info", async (event) => {
    service.track(event, "user-1");

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const [logObj, msg] = mockLogger.info.mock.calls[0];
    expect(msg).toBe("analytics_event");
    expect(logObj.analytics.event).toBe(event);

    await Promise.resolve();
  });

  it("includes userId, tradeId, and metadata in log payload", () => {
    service.track("trade.created", "user-42", "trade-99", { amount: 100 });

    const [logObj] = mockLogger.info.mock.calls[0];
    expect(logObj.analytics).toMatchObject({
      event: "trade.created",
      userId: "user-42",
      tradeId: "trade-99",
      metadata: { amount: 100 },
    });
    expect(typeof logObj.analytics.timestamp).toBe("string");
  });

  it("omits tradeId and metadata when not provided", () => {
    service.track("user.registered", "user-1");

    const [logObj] = mockLogger.info.mock.calls[0];
    expect(logObj.analytics).not.toHaveProperty("tradeId");
    expect(logObj.analytics).not.toHaveProperty("metadata");
  });

  it("calls persistEvent", async () => {
    service.track("trade.funded", "user-1");
    await Promise.resolve();
    expect(service.persistCalled).toBe(true);
  });

  it("does not throw when persistEvent rejects (fire-and-forget)", async () => {
    service.persistResult = Promise.reject(new Error("db down"));

    expect(() => service.track("trade.disputed", "user-1")).not.toThrow();

    // flush multiple microtask ticks so the .catch handler runs
    await new Promise(process.nextTick);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "trade.disputed" }),
      "analytics_event: db write failed",
    );
  });

  it("track returns void synchronously", () => {
    const result = service.track("trade.cancelled", "user-1");
    expect(result).toBeUndefined();
  });
});
