import { appLogger } from "../middleware/logger";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  monitorIntervalMs?: number;
}

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
  }

  getState(): CircuitState {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half-open";
      }
    }
    return this.state;
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.state = "closed";
      this.failureCount = 0;
      appLogger.info("Circuit breaker closed — service recovered");
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.state = "open";
      appLogger.warn(
        { resetTimeoutMs: this.resetTimeoutMs },
        "Circuit breaker re-opened after half-open failure"
      );
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
      appLogger.warn(
        {
          failureCount: this.failureCount,
          resetTimeoutMs: this.resetTimeoutMs,
        },
        "Circuit breaker opened — too many failures"
      );
    }
  }

  isAvailable(): boolean {
    const current = this.getState();
    return current === "closed" || current === "half-open";
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
  }
}

const defaultBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

export async function withCircuitBreaker<T>(
  operation: () => Promise<T>,
  breaker: CircuitBreaker = defaultBreaker
): Promise<T> {
  if (!breaker.isAvailable()) {
    throw new Error("Circuit breaker is open — service temporarily unavailable");
  }

  try {
    const result = await operation();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

export function getCircuitBreaker(): CircuitBreaker {
  return defaultBreaker;
}

export function __resetCircuitBreakerForTests(): void {
  defaultBreaker.reset();
}
