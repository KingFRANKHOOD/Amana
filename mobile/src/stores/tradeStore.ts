import { create } from 'zustand';
import { tradeApi } from '../api/trade';
import type { Trade, TradeListResult, TradeStatus } from '../types/trade';
import { authorizeSensitiveAction } from '../services/biometric.service';
import { signStellarTransaction } from '../services/stellar-wallet-connect.service';
import { useAuthStore } from './authStore';

interface TradeState {
  trades: Trade[];
  total: number;
  currentTrade: Trade | null;
  lastTransactionSubmission: { hash: string; status: string } | null;
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
    deliveryDays?: number;
  }) => Promise<{ tradeId: string; unsignedXdr: string } | null>;
  confirmDelivery: (tradeId: string) => Promise<void>;
  releaseFunds: (tradeId: string, onPairingUri: (uri: string) => void) => Promise<void>;
  deposit: (tradeId: string, onPairingUri: (uri: string) => void) => Promise<void>;
  initiateDispute: (tradeId: string, reason: string) => Promise<void>;
  clearError: () => void;
  resetStore: () => void;
}

async function signAndSubmitTradeTransaction(
  tradeId: string,
  unsignedXdr: string,
  onPairingUri: (uri: string) => void,
) {
  const walletAddress = useAuthStore.getState().walletAddress;
  if (!walletAddress) {
    throw new Error('Connect a Stellar wallet before submitting this transaction.');
  }
  const signedXdr = await signStellarTransaction(unsignedXdr, walletAddress, onPairingUri);
  const submission = await tradeApi.submitSignedTransaction(tradeId, signedXdr);
  if (submission.status !== 'PENDING' && submission.status !== 'DUPLICATE') {
    throw new Error(`Stellar transaction was not accepted: ${submission.status}`);
  }
  return submission;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  trades: [],
  total: 0,
  currentTrade: null,
  lastTransactionSubmission: null,
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
      const authorized = await authorizeSensitiveAction('Authorize new trade');
      if (!authorized) {
        set({ error: 'Authentication cancelled', isLoading: false });
        return null;
      }
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

  releaseFunds: async (tradeId, onPairingUri) => {
    set({ isLoading: true, error: null, lastTransactionSubmission: null });
    try {
      const authorized = await authorizeSensitiveAction('Authorize fund release');
      if (!authorized) {
        set({ error: 'Authentication cancelled', isLoading: false });
        return;
      }
      const { unsignedXdr } = await tradeApi.releaseFunds(tradeId);
      const submission = await signAndSubmitTradeTransaction(tradeId, unsignedXdr, onPairingUri);
      set({ lastTransactionSubmission: submission });
      if (get().currentTrade) {
        await get().fetchTrade(tradeId);
      }
      set({ isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to release funds', isLoading: false });
    }
  },

  deposit: async (tradeId, onPairingUri) => {
    set({ isLoading: true, error: null, lastTransactionSubmission: null });
    try {
      const { unsignedXdr } = await tradeApi.deposit(tradeId);
      const submission = await signAndSubmitTradeTransaction(tradeId, unsignedXdr, onPairingUri);
      set({ lastTransactionSubmission: submission });
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
      const authorized = await authorizeSensitiveAction('Authorize dispute');
      if (!authorized) {
        set({ error: 'Authentication cancelled', isLoading: false });
        return;
      }
      const trade = await tradeApi.initiateDispute(tradeId, reason);
      set({ currentTrade: trade, isLoading: false });
    } catch (e: unknown) {
      set({ error: (e as Error)?.message ?? 'Failed to initiate dispute', isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  resetStore: () =>
    set({
      trades: [],
      total: 0,
      currentTrade: null,
      lastTransactionSubmission: null,
      isLoading: false,
      error: null,
    }),
}));
