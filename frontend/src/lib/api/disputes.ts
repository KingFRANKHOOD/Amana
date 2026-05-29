import { createQueryString, request } from "./client";
import type { DisputeListResponse } from "./types";

export const disputesApi = {
  list: (token: string, params?: { status?: string; page?: number; limit?: number }) =>
    request<DisputeListResponse>(
      `/disputes${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),
};