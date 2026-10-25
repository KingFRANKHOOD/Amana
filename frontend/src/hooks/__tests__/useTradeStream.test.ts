import { renderHook } from "@testing-library/react";
import { useTradeStream } from "../useTradeStream";

jest.mock("@/lib/api", () => ({
  apiConfig: {
    getBaseUrl: () => "https://api.example.com",
  },
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onerror: (() => void) | null = null;
  addEventListener = jest.fn();
  close = jest.fn();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
}

describe("useTradeStream", () => {
  const originalEventSource = global.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource;
  });

  it("never includes the raw auth token in the connection URL", () => {
    const token = "super-secret-token";

    renderHook(() =>
      useTradeStream({ token, tradeIds: ["t1", "t2"], onTradeEvent: jest.fn() }),
    );

    expect(MockEventSource.instances).toHaveLength(1);
    const { url } = MockEventSource.instances[0];
    expect(url).not.toContain(token);
    expect(new URL(url).searchParams.has("token")).toBe(false);
    expect(new URL(url).searchParams.get("trade_ids")).toBe("t1,t2");
  });

  it("authenticates via cookies by opening the stream with credentials", () => {
    renderHook(() =>
      useTradeStream({ token: "abc", tradeIds: ["t1"], onTradeEvent: jest.fn() }),
    );

    expect(MockEventSource.instances[0].withCredentials).toBe(true);
  });
});
