import { createQueryString, request } from "./client";
import type {
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  EvidenceResponse,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
} from "./types";

export const tradesApi = {
  list: (token: string, params?: { status?: string; page?: number; limit?: number }) =>
    request<TradeListResponse>(
      `/trades${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),

  get: (token: string, id: string) =>
    request<TradeResponse>(`/trades/${id}`, { token }),

  getHistory: (token: string, id: string) =>
    request<TradeHistoryResponse>(`/trades/${id}/history`, { token }),

  getEvidence: (token: string, id: string) =>
    request<EvidenceResponse>(`/trades/${id}/evidence`, { token }),

  getStats: (token: string) =>
    request<TradeStatsResponse>("/trades/stats", { token }),

  create: (token: string, data: CreateTradeRequest) =>
    request<CreateTradeResponse>("/trades", {
      method: "POST",
      token,
      body: JSON.stringify(data),
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
};
