import { create } from 'zustand';
import { tradeApi } from '../api/trade';
import type { Trade, TradeListResult, TradeStatus } from '../types/trade';

interface TradeState {
  trades: Trade[];
  total: number;
  currentTrade: Trade | null;
  isLoading: boolean;
  error: string | null;
  fetchTrades: (params?: { status?: TradeStatus; page?: number }) => Promise<void>;
  fetchTrade: (tradeId: string) => Promise<void>;
  confirmDelivery: (tradeId: string) => Promise<void>;
  initiateDispute: (tradeId: string, reason: string) => Promise<void>;
  clearError: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  trades: [],
  total: 0,
  currentTrade: null,
  isLoading: false,
  error: null,

  fetchTrades: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result: TradeListResult = await tradeApi.listTrades(params);
      set({ trades: result.trades, total: result.total, isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to load trades', isLoading: false });
    }
  },

  fetchTrade: async (tradeId) => {
    set({ isLoading: true, error: null });
    try {
      const trade = await tradeApi.getTrade(tradeId);
      set({ currentTrade: trade, isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to load trade', isLoading: false });
    }
  },

  confirmDelivery: async (tradeId) => {
    set({ isLoading: true, error: null });
    try {
      const trade = await tradeApi.confirmDelivery(tradeId);
      set({ currentTrade: trade, isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to confirm delivery', isLoading: false });
    }
  },

  initiateDispute: async (tradeId, reason) => {
    set({ isLoading: true, error: null });
    try {
      const trade = await tradeApi.initiateDispute(tradeId, reason);
      set({ currentTrade: trade, isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to initiate dispute', isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
