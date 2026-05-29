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
}));

import { dispatchEvent } from "../services/eventHandlers";
import * as StellarSdk from "@stellar/stellar-sdk";

type MockOutbox = {
  id: number;
  status: "PENDING" | "RETRYING" | "PROCESSED" | "DEAD_LETTER";
  attempts: number;
  nextAttemptAt: Date;
};

function createMockPrisma() {
  const outbox: MockOutbox = {
    id: 11,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
  };

  const tx = {
    processedEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    chainEventOutbox: {
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
      create: jest.fn().mockResolvedValue({ ...outbox }),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        if (typeof data.attempts === "number") outbox.attempts = data.attempts;
        if (data.status) outbox.status = data.status;
        if (data.nextAttemptAt) outbox.nextAttemptAt = data.nextAttemptAt;
        return { ...outbox };
      }),
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
      .mockReturnValueOnce("TradeCreated")
      .mockReturnValueOnce("trade-001");
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
    prisma.chainEventOutbox.create = jest.fn().mockResolvedValue({
      id: 11,
      status: "RETRYING",
      attempts: 2,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

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
    prisma.chainEventOutbox.create = jest.fn().mockResolvedValue({
      id: 11,
      status: "RETRYING",
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    const service = new EventListenerService(prisma);
    (service as any).running = true;

    (StellarSdk.scValToNative as jest.Mock)
      .mockReset()
      .mockReturnValueOnce("TradeCreated")
      .mockReturnValueOnce("trade-001");

    await service.processEvent(rawEvent());

    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
