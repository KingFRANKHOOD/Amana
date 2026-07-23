import { createQueryString, request } from "./client";
import type {
  DisputeListResponse,
  DisputeResponse,
  ResolveDisputeRequest,
  ResolveDisputeResponse,
} from "./types";

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

  get: (token: string, tradeId: string) =>
    request<DisputeResponse>(`/disputes/${tradeId}`, { token }),

  resolve: (token: string, tradeId: string, data: ResolveDisputeRequest) =>
    request<ResolveDisputeResponse>(`/disputes/${tradeId}/resolve`, {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),
};