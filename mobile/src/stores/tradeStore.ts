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
  createTrade: (data: {
    sellerAddress: string;
    amountUsdc: string;
    buyerLossBps?: number;
    sellerLossBps?: number;
    commodity?: string;
    quantity?: string;
    unit?: string;
  }) => Promise<{ tradeId: string; unsignedXdr: string } | null>;
  confirmDelivery: (tradeId: string) => Promise<void>;
  releaseFunds: (tradeId: string) => Promise<void>;
  deposit: (tradeId: string) => Promise<void>;
  initiateDispute: (tradeId: string, reason: string) => Promise<void>;
  clearError: () => void;
}

export const useTradeStore = create<TradeState>((set, get) => ({
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

  createTrade: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await tradeApi.createTrade(data);
      set({ isLoading: false });
      return result;
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to create trade', isLoading: false });
      return null;
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

  releaseFunds: async (tradeId) => {
    set({ isLoading: true, error: null });
    try {
      await tradeApi.releaseFunds(tradeId);
      if (get().currentTrade) {
        await get().fetchTrade(tradeId);
      }
      set({ isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to release funds', isLoading: false });
    }
  },

  deposit: async (tradeId) => {
    set({ isLoading: true, error: null });
    try {
      await tradeApi.deposit(tradeId);
      if (get().currentTrade) {
        await get().fetchTrade(tradeId);
      }
      set({ isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to deposit', isLoading: false });
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
