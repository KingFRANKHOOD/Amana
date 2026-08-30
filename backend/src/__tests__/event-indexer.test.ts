import { Prisma } from "@prisma/client";
import { EventIndexerService, eventIndexerEmitter } from "../services/event-indexer";
import { __resetMetricsForTests, __setMetricsRecorderForTests } from "../lib/metrics";

const mockGetEvents = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    })),
  },
  scValToNative: jest.fn((value: { native?: string }) => value.native),
}));

jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn(() => ({
    rpcUrl: "https://rpc.example.test",
    contractId: "CONTRACT_TEST",
    pollIntervalMs: 1000,
    backoffInitialMs: 100,
    backoffMaxMs: 1000,
    processedLedgersCacheSize: 100,
    outboxMaxAttempts: 5,
  })),
}));

function makeUniqueError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function makeRawEvent(id = "evt-1") {
  return {
    id,
    ledger: 123,
    contractId: "CONTRACT_TEST",
    txHash: "tx-1",
    topic: [{ native: "TRDCRT" }, { native: "trade-1" }],
    value: null,
  };
}

describe("EventIndexerService", () => {
  afterEach(() => {
    jest.clearAllMocks();
    __resetMetricsForTests();
    eventIndexerEmitter.removeAllListeners("event");
  });

  it("ignores duplicate indexed events without throwing or emitting side effects", async () => {
    const duplicateMetric = jest.fn();
    __setMetricsRecorderForTests({
      recordTransactionSubmission: jest.fn(),
      recordRpcCall: jest.fn(),
      recordDuplicateEventAttempt: duplicateMetric,
    });
    const prisma = {
      indexedEvent: {
        create: jest.fn().mockRejectedValue(makeUniqueError()),
      },
    };
    const emitted = jest.fn();
    eventIndexerEmitter.on("event", emitted);

    const service = new EventIndexerService(prisma as any);

    await expect(service.ingestEvent(makeRawEvent() as any)).resolves.toBeUndefined();

    expect(duplicateMetric).toHaveBeenCalledWith("event-indexer", "TradeCreated");
    expect(emitted).not.toHaveBeenCalled();
  });

  it("stores a single record under parallel duplicate ingestion", async () => {
    const records: Array<Record<string, unknown>> = [];
    const prisma = {
      indexedEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          await Promise.resolve();
          if (records.some((record) => record.eventId === data.eventId)) {
            throw makeUniqueError();
          }
          const record = { id: records.length + 1, ingestedAt: new Date(), ...data };
          records.push(record);
          return record;
        }),
      },
    };
    const emitted = jest.fn();
    eventIndexerEmitter.on("event", emitted);
    const service = new EventIndexerService(prisma as any);

    await Promise.all([
      service.ingestEvent(makeRawEvent("evt-race") as any),
      service.ingestEvent(makeRawEvent("evt-race") as any),
    ]);

    expect(records).toHaveLength(1);
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("resolves tradeId from the event data map for a real single-topic contract event", async () => {
    const records: Array<Record<string, unknown>> = [];
    const prisma = {
      indexedEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { id: records.length + 1, ingestedAt: new Date(), ...data };
          records.push(record);
          return record;
        }),
      },
    };
    const service = new EventIndexerService(prisma as any);

    // The escrow contract emits a single topic element (the event symbol);
    // trade_id lives in the event's data map, e.g. topics=["TRDCRT"].
    const singleTopicEvent = {
      id: "evt-single-topic",
      ledger: 456,
      contractId: "CONTRACT_TEST",
      txHash: "tx-2",
      topic: [{ native: "TRDCRT" }],
      value: {
        type: "map",
        value: [
          { key: { value: "trade_id" }, val: { value: "trade-42" } },
          { key: { value: "buyer" }, val: { value: "GBUYER" } },
        ],
      },
    };

    await service.ingestEvent(singleTopicEvent as any);

    expect(records).toHaveLength(1);
    expect(records[0]?.tradeId).toBe("trade-42");
  });

  it("stores a null tradeId (not the literal string 'unknown') when data has no trade_id", async () => {
    const records: Array<Record<string, unknown>> = [];
    const prisma = {
      indexedEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { id: records.length + 1, ingestedAt: new Date(), ...data };
          records.push(record);
          return record;
        }),
      },
    };
    const service = new EventIndexerService(prisma as any);

    const eventWithoutTradeId = {
      id: "evt-no-trade-id",
      ledger: 789,
      contractId: "CONTRACT_TEST",
      txHash: "tx-3",
      topic: [{ native: "MEDADD" }],
      value: null,
    };

    await service.ingestEvent(eventWithoutTradeId as any);

    expect(records).toHaveLength(1);
    expect(records[0]?.tradeId).toBeNull();
  });
});
