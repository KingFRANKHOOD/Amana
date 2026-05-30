import apiClient from './client';
import type { Trade, TradeListResult, TradeStatus } from '../types/trade';

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
    lossRatio?: number;
  }): Promise<Trade> {
    const response = await apiClient.post('/trades', data);
    return response.data;
  },

  async confirmDelivery(tradeId: string): Promise<Trade> {
    const response = await apiClient.post(`/trades/${tradeId}/confirm`);
    return response.data;
  },

  async initiateDispute(tradeId: string, reason: string): Promise<Trade> {
    const response = await apiClient.post(`/trades/${tradeId}/dispute`, { reason });
    return response.data;
  },
};
