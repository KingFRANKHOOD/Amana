import { mapHistoryToTimeline, mapHistoryToTransactionTimeline } from "../[id]/page";

describe("Asset page history mapping", () => {
  const sampleEvent = {
    eventType: "trade_funded",
    timestamp: "2024-01-02T12:00:00.000Z",
    metadata: { amount: 1000 },
  } as const;

  it("preserves ISO timestamps for timeline rendering", () => {
    const result = mapHistoryToTimeline([sampleEvent]);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(sampleEvent.timestamp);
    expect(result[0].title).toBe("Trade Funded");
  });

  it("preserves ISO timestamps for transaction timeline rendering", () => {
    const result = mapHistoryToTransactionTimeline([sampleEvent]);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(sampleEvent.timestamp);
    expect(result[0].actor).toBe("system");
  });
});
