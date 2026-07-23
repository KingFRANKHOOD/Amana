import { getApiBaseUrl } from "./env";
import { trackApiFailure } from "@/lib/analytics";
import { parseBackendError, BackendErrorResponse } from "../errorHandler";
import { z } from "zod";

export type FetchOptions = RequestInit & {
  token?: string | null;
  skipAuth?: boolean;
  timeoutMs?: number;
};

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

export class ApiError extends Error {
  status: number;
  data: unknown;
  backendError?: BackendErrorResponse | null;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.backendError = parseBackendError(this);
  }
}

const TOKEN_STORAGE_KEY = "amana_jwt";
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export const navigationHelpers = {
  reload(): void {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  },
};

function createHeaders(
  headers?: HeadersInit,
  token?: string | null,
): Record<string, string> {
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      resolvedHeaders[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      resolvedHeaders[key] = value;
    }
  } else if (headers) {
    Object.assign(resolvedHeaders, headers);
  }

  if (token) {
    resolvedHeaders.Authorization = `Bearer ${token}`;
  }

  return resolvedHeaders;
}

export function createQueryString(
  params?: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function request<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const {
    token,
    skipAuth,
    headers,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    signal,
    ...fetchOptions
  } = options;

  const authToken = token ?? (!skipAuth ? getStoredToken() : null);
  const controller = new AbortController();
  let timedOut = false;
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const abortRequest = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortRequest, { once: true });
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      ...fetchOptions,
      headers: createHeaders(headers, authToken),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      trackApiFailure(endpoint, response.status, {
        method: fetchOptions.method ?? "GET",
      });
      throw new ApiError(
        response.status,
        (data as { error?: string })?.error || response.statusText,
        data,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      timedOut && error instanceof DOMException && error.name === "AbortError"
        ? `Request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "Network error";
    trackApiFailure(endpoint, 0, {
      method: fetchOptions.method ?? "GET",
      error: message,
    });
    throw new ApiError(0, message);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    signal?.removeEventListener("abort", abortRequest);
  }
}

export async function requestWithResult<T>(
  endpoint: string,
  schema?: z.ZodSchema<T>,
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  try {
    const data = await request<T>(endpoint, options);

    if (schema) {
      const validationResult = schema.safeParse(data);
      if (!validationResult.success) {
        throw new ApiError(
          500,
          "Response validation failed",
          validationResult.error,
        );
      }
      return { success: true, data: validationResult.data };
    }

    return { success: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        const storedToken = getStoredToken();
        if (storedToken) {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          navigationHelpers.reload();
        }
      }
      return { success: false, error };
    }
    return {
      success: false,
      error: new ApiError(
        0,
        error instanceof Error ? error.message : "Unknown error",
      ),
    };
  }
}
