import { getApiBaseUrl } from "./env";

export type FetchOptions = RequestInit & {
  token?: string | null;
};

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function createHeaders(headers?: HeadersInit, token?: string | null): Record<string, string> {
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

export function createQueryString(params?: Record<string, string | number | undefined>): string {
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

export async function request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { token, headers, ...fetchOptions } = options;
  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...fetchOptions,
    headers: createHeaders(headers, token),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, (data as any)?.error || response.statusText, data);
  }

  return data as T;
}
