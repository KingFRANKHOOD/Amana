import { EventListenerService } from "../services/eventListener.service";

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    })),
  },
  scValToNative: jest.fn(),
}));

jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn().mockReturnValue({
    rpcUrl: "https://rpc.example.com",
    contractId: "CONTRACT_OUTBOX",
    pollIntervalMs: 1000,
    backoffInitialMs: 100,
    backoffMaxMs: 800,
    processedLedgersCacheSize: 100,
    outboxMaxAttempts: 3,
  }),
}));

jest.mock("../services/eventHandlers", () => ({
  dispatchEvent: jest.fn(),
  MissingTradeError: class MissingTradeError extends Error {
    tradeId: string;
    eventType: string;
    constructor(tradeId: string, eventType: string) {
      super(`Trade ${tradeId} not found for event ${eventType}`);
      this.name = "MissingTradeError";
      this.tradeId = tradeId;
      this.eventType = eventType;
    }
  },
}));

import { dispatchEvent, MissingTradeError } from "../services/eventHandlers";
import * as StellarSdk from "@stellar/stellar-sdk";

type MockOutbox = {
  id: number;
  status: "PENDING" | "RETRYING" | "PROCESSED" | "DEAD_LETTER";
  attempts: number;
  nextAttemptAt: Date;
  tradeId: string;
  ledgerSequence: number;
};

function createMockPrisma() {
  const outbox: MockOutbox = {
    id: 11,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
    tradeId: "trade-001",
    ledgerSequence: 99,
  };

  const tx = {
    processedEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    chainEventOutbox: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        if (typeof data.attempts === "number") outbox.attempts = data.attempts;
        if (data.attempts?.increment) outbox.attempts += data.attempts.increment;
        if (data.status) outbox.status = data.status;
        if (data.nextAttemptAt) outbox.nextAttemptAt = data.nextAttemptAt;
        return { ...outbox };
      }),
    },
  };

  return {
    processedEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chainEventOutbox: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ ...outbox }),
      upsert: jest.fn().mockImplementation(async () => ({ ...outbox })),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        if (typeof data.attempts === "number") outbox.attempts = data.attempts;
        if (data.attempts?.increment) outbox.attempts += data.attempts.increment;
        if (data.status) outbox.status = data.status;
        if (data.nextAttemptAt) outbox.nextAttemptAt = data.nextAttemptAt;
        return { ...outbox };
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    _outbox: outbox,
    _tx: tx,
  } as any;
}

function rawEvent() {
  return {
    ledger: 99,
    id: "evt-99",
    contractId: "CONTRACT_OUTBOX",
    topic: [{ _symbol: "TradeCreated" }, { _id: "trade-001" }],
    value: {},
  } as any;
}

describe("EventListenerService outbox retries", () => {
  beforeEach(() => {
    (dispatchEvent as jest.Mock).mockReset();
    (StellarSdk.scValToNative as jest.Mock)
      .mockReset()
      .mockReturnValue("TRDCRT");
  });

  it("marks outbox row RETRYING with backoff when handler fails", async () => {
    const prisma = createMockPrisma();
    const service = new EventListenerService(prisma);
    (service as any).running = true;

    (dispatchEvent as jest.Mock).mockRejectedValueOnce(new Error("temporary failure"));

    await service.processEvent(rawEvent());

    expect(prisma.chainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          status: "RETRYING",
          attempts: 1,
        }),
      }),
    );
  });

  it("moves outbox row to DEAD_LETTER when max attempts reached", async () => {
    const prisma = createMockPrisma();
    prisma._outbox.status = "RETRYING";
    prisma._outbox.attempts = 2;
    prisma._outbox.nextAttemptAt = new Date(Date.now() - 1000);
    prisma.chainEventOutbox.upsert = jest.fn().mockResolvedValue({ ...prisma._outbox });

    const service = new EventListenerService(prisma);
    (service as any).running = true;

    (dispatchEvent as jest.Mock).mockRejectedValueOnce(new Error("still failing"));

    await service.processEvent(rawEvent());

    expect(prisma.chainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          attempts: 3,
        }),
      }),
    );
  });

  it("skips processing when nextAttemptAt is in the future", async () => {
    const prisma = createMockPrisma();
    prisma._outbox.status = "RETRYING";
    prisma._outbox.attempts = 1;
    prisma._outbox.nextAttemptAt = new Date(Date.now() + 60_000);
    prisma.chainEventOutbox.upsert = jest.fn().mockResolvedValue({ ...prisma._outbox });

    const service = new EventListenerService(prisma);
    (service as any).running = true;

    (StellarSdk.scValToNative as jest.Mock)
      .mockReset()
      .mockReturnValue("TRDCRT");

    await service.processEvent(rawEvent());

    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
