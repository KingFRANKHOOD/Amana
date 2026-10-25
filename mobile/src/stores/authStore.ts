import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { useTradeStore } from './tradeStore';

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => Promise<void>;
  getToken: () => Promise<string | null>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletAddress: null,
  isLoading: true,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync('amana_token', token);
    set({ token });
  },

  setWalletAddress: async (address: string) => {
    await SecureStore.setItemAsync('amana_wallet_address', address);
    set({ walletAddress: address });
  },

  getToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('amana_token');
      const walletAddress = await SecureStore.getItemAsync('amana_wallet_address');
      set({ token, walletAddress });
      return token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  },

  clearAuth: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync('amana_token'),
      SecureStore.deleteItemAsync('amana_wallet_address'),
    ]);
    useTradeStore.getState().resetStore();
    set({ token: null, walletAddress: null });
  },
}));
