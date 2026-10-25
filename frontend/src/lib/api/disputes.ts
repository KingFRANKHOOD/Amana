import { createQueryString, request } from "./client";
import { getApiBaseUrl } from "./env";
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

  exportCsv: async (token: string, params?: { status?: string }) => {
    const response = await fetch(
      `${getApiBaseUrl()}/disputes/export${createQueryString({
        format: "csv",
        status: params?.status,
      })}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      throw new Error(response.statusText || "Failed to export disputes");
    }
    return response.blob();
  },
};
