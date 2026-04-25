"use client";

import { useCallback, useRef, useState } from "react";

export interface RetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
}

export interface RetryState<T> {
  data: T | null;
  isLoading: boolean;
  isRetrying: boolean;
  error: Error | null;
  attempt: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

export function useRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): {
  execute: () => Promise<T | null>;
  state: RetryState<T>;
  reset: () => void;
} {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, setState] = useState<RetryState<T>>({
    data: null,
    isLoading: false,
    isRetrying: false,
    error: null,
    attempt: 0,
  });
  const attemptRef = useRef(0);

  const calculateDelay = useCallback(
    (attempt: number) => {
      const delay = resolvedConfig.initialDelayMs *
        Math.pow(resolvedConfig.backoffMultiplier, attempt);
      return Math.min(delay, resolvedConfig.maxDelayMs);
    },
    [resolvedConfig]
  );

  const isRetryable = useCallback(
    (error: Error): boolean => {
      if ("status" in error && typeof (error as { status?: number }).status === "number") {
        return resolvedConfig.retryableStatuses.includes(
          (error as { status: number }).status
        );
      }
      return true;
    },
    [resolvedConfig]
  );

  const reset = useCallback(() => {
    setState({
      data: null,
      isLoading: false,
      isRetrying: false,
      error: null,
      attempt: 0,
    });
    attemptRef.current = 0;
  }, []);

  const execute = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    for (let attempt = 0; attempt <= resolvedConfig.maxAttempts; attempt++) {
      attemptRef.current = attempt;

      try {
        const data = await fn();

        setState({
          data,
          isLoading: false,
          isRetrying: false,
          error: null,
          attempt,
        });

        return data;
      } catch (error) {
        const isLastAttempt = attempt >= resolvedConfig.maxAttempts - 1;
        const shouldRetry = !isLastAttempt && isRetryable(error as Error);

        if (!shouldRetry) {
          const errorMessage = error instanceof Error
            ? error.message
            : "Request failed";
          setState({
            data: null,
            isLoading: false,
            isRetrying: false,
            error: error as Error,
            attempt,
          });
          return null;
        }

        setState((prev) => ({
          ...prev,
          isLoading: false,
          isRetrying: true,
          attempt: attempt + 1,
        }));

        const delay = calculateDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return null;
  }, [fn, resolvedConfig, calculateDelay, isRetryable]);

  return { execute, state, reset };
}