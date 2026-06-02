import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => void;
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

  setWalletAddress: (address: string) => {
    set({ walletAddress: address });
  },

  getToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('amana_token');
      set({ token });
      return token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync('amana_token');
    set({ token: null, walletAddress: null });
  },
}));
