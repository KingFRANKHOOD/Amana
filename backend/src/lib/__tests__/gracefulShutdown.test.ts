import { createGracefulShutdown, type ShutdownClosable } from "../gracefulShutdown";

function closable(): ShutdownClosable & { close: jest.Mock } {
  return { close: jest.fn().mockResolvedValue(undefined) };
}

describe("createGracefulShutdown", () => {
  it("stops services, drains workers, closes queues, and exits successfully", async () => {
    const server = { close: jest.fn((callback: (error?: Error) => void) => callback()) } as never;
    const services = [closable(), closable()];
    const workers = [closable(), closable()];
    const queues = [closable(), closable()];
    const stopMetrics = jest.fn();
    const disconnectDatabase = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({
      getServer: () => server,
      services,
      workers,
      queues,
      stopMetrics,
      disconnectDatabase,
      exit,
      timeoutMs: 100,
    });

    await shutdown("SIGTERM");

    expect(services.every((service) => service.close.mock.calls.length === 1)).toBe(true);
    expect(workers.every((worker) => worker.close.mock.calls.length === 1)).toBe(true);
    expect(queues.every((queue) => queue.close.mock.calls.length === 1)).toBe(true);
    expect(stopMetrics).toHaveBeenCalledTimes(1);
    expect(disconnectDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit when shutdown does not finish before the timeout", async () => {
    const hangingWorker = closable();
    hangingWorker.close.mockReturnValue(new Promise<void>(() => {}));
    const exit = jest.fn();

    const shutdown = createGracefulShutdown({
      getServer: () => null,
      services: [],
      workers: [hangingWorker],
      queues: [],
      stopMetrics: jest.fn(),
      disconnectDatabase: jest.fn().mockResolvedValue(undefined),
      exit,
      timeoutMs: 1,
    });

    await shutdown("SIGINT");

    expect(exit).toHaveBeenCalledWith(1);
  });
});