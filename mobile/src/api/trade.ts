import apiClient from './client';
import type { Trade, TradeListResult, TradeStatus } from '../types/trade';

/**
 * Backend's TradeStatus enum (backend/prisma/schema.prisma) is the source of
 * truth. Keep this list in sync so the mobile client never sends a status the
 * server-side nativeEnum(TradeStatus) validator would reject with HTTP 400.
 */
export const BACKEND_TRADE_STATUSES = [
  'PENDING_SIGNATURE',
  'CREATED',
  'FUNDED',
  'DELIVERED',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
] as const satisfies readonly TradeStatus[];

export function isValidTradeStatus(status: string): status is TradeStatus {
  return (BACKEND_TRADE_STATUSES as readonly string[]).includes(status);
}

export const tradeApi = {
  async listTrades(params?: {
    status?: TradeStatus;
    page?: number;
    limit?: number;
  }): Promise<TradeListResult> {
    const response = await apiClient.get('/trades', { params });
    return response.data;
  },

  async getTrade(tradeId: string): Promise<Trade> {
    const response = await apiClient.get(`/trades/${tradeId}`);
    return response.data;
  },

  async createTrade(data: {
    sellerAddress: string;
    amountUsdc: string;
    buyerLossBps?: number;
    sellerLossBps?: number;
    commodity?: string;
    quantity?: string;
    unit?: string;
  }): Promise<{ tradeId: string; unsignedXdr: string }> {
    const response = await apiClient.post('/trades', data);
    return response.data;
  },

  async confirmDelivery(tradeId: string): Promise<Trade> {
    const response = await apiClient.post(`/trades/${tradeId}/confirm`);
    return response.data;
  },

  async releaseFunds(tradeId: string): Promise<{ unsignedXdr: string }> {
    const response = await apiClient.post(`/trades/${tradeId}/release`);
    return response.data;
  },

  async deposit(tradeId: string): Promise<{ unsignedXdr: string }> {
    const response = await apiClient.post(`/trades/${tradeId}/deposit`);
    return response.data;
  },

  async initiateDispute(tradeId: string, reason: string): Promise<Trade> {
    const response = await apiClient.post(`/trades/${tradeId}/dispute`, { reason });
    return response.data;
  },
};
