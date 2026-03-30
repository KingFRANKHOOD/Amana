const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000];
const DEFAULT_MAX_RETRIES = 3;

type SleepFn = (ms: number) => Promise<void>;

export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number[];
  sleep?: SleepFn;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, retryCount: number, delayMs: number) => void;
}

let sleepImpl: SleepFn = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidates = [
    (error as any).status,
    (error as any).statusCode,
    (error as any).response?.status,
    (error as any).response?.statusCode,
    (error as any).response?.data?.status,
  ];

  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status)) {
      return status;
    }
  }

  return undefined;
}

export function isRetryableNetworkError(error: unknown): boolean {
  const status = getErrorStatus(error);

  if (status === 429) {
    return true;
  }

  if (status !== undefined) {
    return status >= 500 && status < 600;
  }

  return false;
}

export async function retryAsync<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableNetworkError;
  const sleep = options.sleep ?? sleepImpl;

  let retryCount = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (retryCount >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const delayMs =
        backoffMs[Math.min(retryCount, backoffMs.length - 1)] ?? 0;
      retryCount += 1;
      options.onRetry?.(error, retryCount, delayMs);
      await sleep(delayMs);
    }
  }
}

export function __setRetrySleepForTests(sleep: SleepFn): void {
  sleepImpl = sleep;
}

export function __resetRetrySleepForTests(): void {
  sleepImpl = async (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
}
