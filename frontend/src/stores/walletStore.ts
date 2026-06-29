import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface WalletState {
  publicKey: string | null;
  network: string;
  balances: Record<string, string>;
  isConnected: boolean;
  isConnecting: boolean;
  connect: (publicKey: string, network: string) => void;
  disconnect: () => void;
  setBalances: (balances: Record<string, string>) => void;
  reset: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      network: 'public',
      balances: {},
      isConnected: false,
      isConnecting: false,

      connect: (publicKey: string, network: string) => {
        set({
          publicKey,
          network,
          isConnected: true,
          isConnecting: false,
        });
      },

      disconnect: () => {
        set({
          publicKey: null,
          network: 'public',
          balances: {},
          isConnected: false,
          isConnecting: false,
        });
      },

      setBalances: (balances: Record<string, string>) => {
        set({ balances });
      },

      reset: () => {
        set({
          publicKey: null,
          network: 'public',
          balances: {},
          isConnected: false,
          isConnecting: false,
        });
      },
    }),
    {
      name: 'amana_wallet_store',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : (null as unknown as Storage))),
      partialize: (state) => ({
        publicKey: state.publicKey,
        network: state.network,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.publicKey) {
          state.isConnected = true;
        }
      },
    }
  )
);
