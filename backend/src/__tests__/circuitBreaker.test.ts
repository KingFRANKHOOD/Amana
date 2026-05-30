import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../lib/circuitBreaker";

function makeBreaker(overrides: { failureThreshold?: number; successThreshold?: number; cooldownMs?: number } = {}) {
  let fakeNow = 0;
  const breaker = new CircuitBreaker("test", {
    failureThreshold: 3,
    successThreshold: 2,
    cooldownMs: 10_000,
    now: () => fakeNow,
    ...overrides,
  });
  return { breaker, advanceTime: (ms: number) => { fakeNow += ms; } };
}

const fail = () => Promise.reject(new Error("boom"));
const succeed = () => Promise.resolve("ok");

describe("CircuitBreaker", () => {
  it("starts CLOSED and passes through successful calls", async () => {
    const { breaker } = makeBreaker();
    expect(breaker.currentState).toBe("CLOSED");
    await expect(breaker.call(succeed)).resolves.toBe("ok");
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("stays CLOSED below the failure threshold", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });
    await expect(breaker.call(fail)).rejects.toThrow("boom");
    await expect(breaker.call(fail)).rejects.toThrow("boom");
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("opens after reaching the failure threshold", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(fail)).rejects.toThrow();
    }
    expect(breaker.currentState).toBe("OPEN");
  });

  it("blocks calls immediately when OPEN", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 2 });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    expect(breaker.currentState).toBe("OPEN");

    await expect(breaker.call(succeed)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("transitions to HALF_OPEN after the cooldown elapses", async () => {
    const { breaker, advanceTime } = makeBreaker({ failureThreshold: 2, cooldownMs: 5_000 });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    expect(breaker.currentState).toBe("OPEN");

    advanceTime(5_001);
    await expect(breaker.call(succeed)).resolves.toBe("ok");
    // After one success we're still HALF_OPEN (successThreshold = 2)
    expect(breaker.currentState).toBe("HALF_OPEN");
  });

  it("closes after enough successes in HALF_OPEN", async () => {
    const { breaker, advanceTime } = makeBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      cooldownMs: 5_000,
    });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    advanceTime(5_001);

    await breaker.call(succeed);
    await breaker.call(succeed);
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("re-opens immediately on failure in HALF_OPEN", async () => {
    const { breaker, advanceTime } = makeBreaker({ failureThreshold: 2, cooldownMs: 5_000 });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    advanceTime(5_001);

    // First call in HALF_OPEN fails
    await expect(breaker.call(fail)).rejects.toThrow("boom");
    expect(breaker.currentState).toBe("OPEN");
  });

  it("resets failure count on success while CLOSED", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    await breaker.call(succeed); // resets count
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    // Only 2 failures after the reset — should still be CLOSED
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("does not transition while cooldown has not elapsed", async () => {
    const { breaker, advanceTime } = makeBreaker({ failureThreshold: 2, cooldownMs: 10_000 });
    await breaker.call(fail).catch(() => {});
    await breaker.call(fail).catch(() => {});
    advanceTime(9_999); // just short of cooldown
    await expect(breaker.call(succeed)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(breaker.currentState).toBe("OPEN");
  });
});
