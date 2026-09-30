import { createQueryString, request } from "./client";
import { getApiBaseUrl } from "./env";
import type {
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  EvidenceResponse,
  EvidenceUploadResponse,
  SubmitManifestRequest,
  SubmitManifestResponse,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
} from "./types";

export const tradesApi = {
  list: (token: string, params?: { status?: string; page?: number; limit?: number; sort?: string }) =>
    request<TradeListResponse>(
      `/trades${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
        sort: params?.sort,
      })}`,
      { token },
    ),

  get: (token: string, id: string) =>
    request<TradeResponse>(`/trades/${id}`, { token }),

  getHistory: (token: string, id: string) =>
    request<TradeHistoryResponse>(`/trades/${id}/history`, { token }),

  getEvidence: (token: string, id: string) =>
    request<EvidenceResponse>(`/trades/${id}/evidence`, { token }),

  uploadEvidence: (token: string, tradeId: string, file: File) => {
    const formData = new FormData();
    formData.append("tradeId", tradeId);
    formData.append("file", file);

    return request<EvidenceUploadResponse>("/evidence/video", {
      method: "POST",
      token,
      body: formData,
    });
  },

  submitManifest: (token: string, tradeId: string, data: SubmitManifestRequest) =>
    request<SubmitManifestResponse>(`/trades/${tradeId}/manifest`, {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),

  getStats: (token: string) =>
    request<TradeStatsResponse>("/trades/stats", { token }),

  create: (token: string, data: CreateTradeRequest) =>
    request<CreateTradeResponse>("/trades", {
      method: "POST",
      token,
      body: JSON.stringify({
        sellerAddress: data.sellerAddress,
        amountUsdc: data.amountUsdc,
        buyerLossBps: data.buyerLossBps,
        sellerLossBps: data.sellerLossBps,
      }),
    }),

  deposit: (token: string, tradeId: string) =>
    request<DepositResponse>(`/trades/${tradeId}/deposit`, {
      method: "POST",
      token,
    }),

  confirmDelivery: (token: string, tradeId: string) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/confirm`, {
      method: "POST",
      token,
    }),

  releaseFunds: (token: string, tradeId: string) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/release`, {
      method: "POST",
      token,
    }),

  initiateDispute: (token: string, tradeId: string, reason: string, category: string) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/dispute`, {
      method: "POST",
      token,
      body: JSON.stringify({ reason, category }),
    }),

  exportCsv: async (
    token: string,
    params?: { status?: string; from?: string; to?: string },
  ) => {
    const response = await fetch(
      `${getApiBaseUrl()}/trades/export${createQueryString({
        format: "csv",
        status: params?.status,
        from: params?.from,
        to: params?.to,
      })}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      throw new Error(response.statusText || "Failed to export trades");
    }
    return response.blob();
  },
};
