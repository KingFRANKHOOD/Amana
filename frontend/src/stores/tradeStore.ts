import { create } from "zustand";
import { tradesApi } from "@/lib/api/trades";
import type { TradeResponse } from "@/lib/api/types";

interface Filters {
  status?: string;
}

interface TradeState {
  trades: TradeResponse[];
  total: number;
  page: number;
  filters: Filters;
  isLoading: boolean;
  error: string | null;
  fetchTrades: (token: string) => Promise<void>;
  setPage: (page: number, token: string) => Promise<void>;
  setFilter: (filters: Filters, token: string) => Promise<void>;
  addTrade: (trade: TradeResponse) => void;
  updateTrade: (tradeId: string, patch: Partial<TradeResponse>, serverFn?: () => Promise<void>) => Promise<void>;
  removeTrade: (tradeId: string, serverFn?: () => Promise<void>) => Promise<void>;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  trades: [],
  total: 0,
  page: 1,
  filters: {},
  isLoading: false,
  error: null,

  fetchTrades: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const { page, filters } = get();
      const res = await tradesApi.list(token, { status: filters.status, page });
      set({ trades: res.items, total: res.pagination.total, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message ?? "Failed to load trades", isLoading: false });
    }
  },

  setPage: async (page, token) => {
    set({ page });
    await get().fetchTrades(token);
  },

  setFilter: async (filters, token) => {
    set({ filters, page: 1 });
    await get().fetchTrades(token);
  },

  addTrade: (trade) => {
    set((s) => ({ trades: [trade, ...s.trades], total: s.total + 1 }));
  },

  updateTrade: async (tradeId, patch, serverFn) => {
    const prev = get().trades;
    set({ trades: prev.map((t) => (t.tradeId === tradeId ? { ...t, ...patch } : t)) });
    if (serverFn) {
      try {
        await serverFn();
      } catch {
        set({ trades: prev });
      }
    }
  },

  removeTrade: async (tradeId, serverFn) => {
    const prev = get().trades;
    const prevTotal = get().total;
    set({ trades: prev.filter((t) => t.tradeId !== tradeId), total: prevTotal - 1 });
    if (serverFn) {
      try {
        await serverFn();
      } catch {
        set({ trades: prev, total: prevTotal });
      }
    }
  },
}));
