export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold?: number;
  /** Number of consecutive successes in HALF_OPEN before closing again. */
  successThreshold?: number;
  /** Milliseconds to wait in OPEN state before moving to HALF_OPEN. */
  cooldownMs?: number;
  /** Override Date.now() for deterministic tests. */
  now?: () => number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is OPEN — call blocked`);
    this.name = "CircuitBreakerOpenError";
  }
}

const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreakerStates(): Array<{ name: string; state: CircuitState }> {
  return Array.from(registry.entries()).map(([name, cb]) => ({
    name,
    state: cb.currentState,
  }));
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    registry.set(name, this);
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get failureCountValue(): number {
    return this.failureCount;
  }

  get successCountValue(): number {
    return this.successCount;
  }

  get openedAtValue(): number | null {
    return this.openedAt;
  }

  get cooldownMsValue(): number {
    return this.cooldownMs;
  }

  async call<T>(operation: () => Promise<T>): Promise<T> {
    this.transitionIfCooldownElapsed();

    if (this.state === "OPEN") {
      throw new CircuitBreakerOpenError(this.name);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private transitionIfCooldownElapsed(): void {
    if (this.state === "OPEN" && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        this.failureCount = 0;
      }
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount += 1;
      if (this.successCount >= this.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
        this.openedAt = null;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = this.now();
      this.failureCount = 0;
      this.successCount = 0;
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
      this.successCount = 0;
    }
  }
}
