import {
  isAnalyticsOptedOut,
  scrubProperties,
  setAnalyticsOptOut,
  trackDisputeEvent,
  trackEvent,
  trackPageView,
  trackTradeCreationStep,
  trackTradeStatusChange,
} from "@/lib/analytics";

// ─── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ─── scrubProperties ──────────────────────────────────────────────────────────

describe("scrubProperties", () => {
  it("redacts sensitive keys", () => {
    const input = {
      email: "alice@example.com",
      firstName: "Alice",
      walletAddress: "0x1234567890123456789012345678901234567890",
      safeValue: "hello",
    };

    const output = scrubProperties(input);

    expect(output.email).toBe("[REDACTED]");
    expect(output.firstName).toBe("[REDACTED]");
    expect(output.walletAddress).toBe("[REDACTED]");
    expect(output.safeValue).toBe("hello");
  });

  it("redacts embedded PII patterns in string values", () => {
    const input = {
      message: "Contact bob@domain.com for support",
      ip: "192.168.0.1",
      nested: {
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      },
    };

    const output = scrubProperties(input);

    expect(output.message).toBe("[REDACTED]");
    expect(output.ip).toBe("[REDACTED]");
    expect((output.nested as { wallet: string }).wallet).toBe("[REDACTED]");
  });

  it("redacts Stellar public keys and muxed accounts under non-sensitive keys", () => {
    const input = {
      counterparty: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      destination: `MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAGZFQ`,
      memo: "Paying GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ now",
      label: "GENERAL-STATUS",
    };

    const output = scrubProperties(input);

    expect(output.counterparty).toBe("[REDACTED]");
    expect(output.destination).toBe("[REDACTED]");
    expect(output.memo).toBe("[REDACTED]");
    expect(output.label).toBe("GENERAL-STATUS");
  });

  it("passes through safe scalar values unchanged", () => {
    const input = { step: "details", count: 3, flag: true };
    const output = scrubProperties(input);
    expect(output.step).toBe("details");
    expect(output.count).toBe(3);
    expect(output.flag).toBe(true);
  });

  it("redacts array items that contain PII", () => {
    const input = { tags: ["bob@domain.com", "safe-label"] };
    const output = scrubProperties(input);
    const tags = output.tags as string[];
    expect(tags[0]).toBe("[REDACTED]");
    expect(tags[1]).toBe("safe-label");
  });
});

// ─── Opt-out helpers ──────────────────────────────────────────────────────────

describe("analytics opt-out", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("is opted in by default", () => {
    expect(isAnalyticsOptedOut()).toBe(false);
  });

  it("persists opt-out to localStorage", () => {
    setAnalyticsOptOut(true);
    expect(isAnalyticsOptedOut()).toBe(true);
    expect(localStorageMock.getItem("amana_analytics_opt_out")).toBe("true");
  });

  it("removes the key when opting back in", () => {
    setAnalyticsOptOut(true);
    setAnalyticsOptOut(false);
    expect(isAnalyticsOptedOut()).toBe(false);
    expect(localStorageMock.getItem("amana_analytics_opt_out")).toBeNull();
  });
});

// ─── publishEvent respects opt-out ────────────────────────────────────────────

describe("publishEvent respects opt-out", () => {
  const consoleSpy = jest
    .spyOn(console, "debug")
    .mockImplementation(() => {});
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    localStorageMock.clear();
    consoleSpy.mockClear();
    (process.env as Record<string, string>).NODE_ENV = "development";
  });

  afterAll(() => {
    consoleSpy.mockRestore();
    (process.env as Record<string, string>).NODE_ENV = originalEnv;
  });

  it("emits console.debug in development when opted in", () => {
    setAnalyticsOptOut(false);
    trackEvent("test_event", { foo: "bar" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Analytics event:",
      "test_event",
      expect.any(Object),
    );
  });

  it("suppresses all events when opted out", () => {
    setAnalyticsOptOut(true);
    trackEvent("test_event", { foo: "bar" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// ─── Trade lifecycle tracking helpers ────────────────────────────────────────
// Use a custom endpoint provider so events are dispatched via fetch.
// We assign a mock fetch to global since jsdom may not provide it.

describe("trade lifecycle tracking helpers", () => {
  let originalProvider: string | undefined;
  let originalEndpoint: string | undefined;
  let mockFetch: jest.Mock;

  beforeAll(() => {
    originalProvider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
    originalEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_PROVIDER = "custom";
    (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_ENDPOINT =
      "https://analytics.example.com/events";

    // Stub sendBeacon to return false so the code falls through to fetch
    Object.defineProperty(navigator, "sendBeacon", {
      writable: true,
      configurable: true,
      value: jest.fn().mockReturnValue(false),
    });
  });

  afterAll(() => {
    if (originalProvider === undefined) {
      delete (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_PROVIDER;
    } else {
      (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_PROVIDER = originalProvider;
    }
    if (originalEndpoint === undefined) {
      delete (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    } else {
      (process.env as Record<string, string>).NEXT_PUBLIC_ANALYTICS_ENDPOINT = originalEndpoint;
    }
  });

  beforeEach(() => {
    localStorageMock.clear();
    // Assign mock fetch directly to global so the module can call it
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    (global as unknown as Record<string, unknown>).fetch = mockFetch;
  });

  afterEach(() => {
    delete (global as unknown as Record<string, unknown>).fetch;
  });

  it("trackPageView dispatches an event when opted in", () => {
    setAnalyticsOptOut(false);
    trackPageView("/trades");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://analytics.example.com/events");
  });

  it("trackTradeCreationStep dispatches an event when opted in", () => {
    setAnalyticsOptOut(false);
    trackTradeCreationStep("details");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("trackTradeCreationStep with metadata dispatches an event", () => {
    setAnalyticsOptOut(false);
    trackTradeCreationStep("review", { hasManifest: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("trackTradeStatusChange dispatches an event when opted in", () => {
    setAnalyticsOptOut(false);
    trackTradeStatusChange("FUNDED");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("trackDisputeEvent dispatches an event when opted in", () => {
    setAnalyticsOptOut(false);
    trackDisputeEvent("initiated");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("all helpers are suppressed when opted out", () => {
    setAnalyticsOptOut(true);
    trackPageView("/trades");
    trackTradeCreationStep("details");
    trackTradeStatusChange("COMPLETED");
    trackDisputeEvent("resolved");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
