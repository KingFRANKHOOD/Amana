import {
  CircuitBreaker,
  withCircuitBreaker,
  __resetCircuitBreakerForTests,
} from "../lib/circuit-breaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    __resetCircuitBreakerForTests();
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
  });

  it("starts in closed state", () => {
    expect(breaker.getState()).toBe("closed");
    expect(breaker.isAvailable()).toBe(true);
  });

  it("opens after reaching failure threshold", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
    expect(breaker.isAvailable()).toBe(false);
  });

  it("resets failure count on success", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");
  });

  it("transitions to half-open after reset timeout", async () => {
    const shortBreaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    shortBreaker.recordFailure();
    expect(shortBreaker.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 60));
    expect(shortBreaker.getState()).toBe("half-open");
    expect(shortBreaker.isAvailable()).toBe(true);
  });

  it("closes after successful half-open probe", async () => {
    const shortBreaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    shortBreaker.recordFailure();
    await new Promise((r) => setTimeout(r, 60));
    expect(shortBreaker.getState()).toBe("half-open");

    shortBreaker.recordSuccess();
    expect(shortBreaker.getState()).toBe("closed");
  });

  it("re-opens after failed half-open probe", async () => {
    const shortBreaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    shortBreaker.recordFailure();
    await new Promise((r) => setTimeout(r, 60));
    expect(shortBreaker.getState()).toBe("half-open");

    shortBreaker.recordFailure();
    expect(shortBreaker.getState()).toBe("open");
  });

  it("reset restores closed state", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.isAvailable()).toBe(true);
  });
});

describe("withCircuitBreaker", () => {
  it("executes operation when circuit is closed", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    const result = await withCircuitBreaker(async () => "success", breaker);
    expect(result).toBe("success");
  });

  it("throws when circuit is open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60000,
    });

    breaker.recordFailure();

    await expect(
      withCircuitBreaker(async () => "should not run", breaker)
    ).rejects.toThrow("Circuit breaker is open");
  });

  it("records failure when operation throws", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    await expect(
      withCircuitBreaker(async () => {
        throw new Error("service error");
      }, breaker)
    ).rejects.toThrow("service error");

    expect(breaker.getState()).toBe("closed");
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });
});
