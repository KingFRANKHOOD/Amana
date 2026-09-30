import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getAddress, isAllowed, isConnected as checkFreighterConnected } from '@stellar/freighter-api';

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
          // Verify the persisted wallet is still authorized by Freighter
          verifyPersistedWallet(state);
        }
      },
    }
  )
);

/**
 * Verifies that a persisted wallet address is still valid and authorized
 * by checking with Freighter's APIs. This prevents stale connection state
 * when the extension has been locked, disconnected, switched to a different
 * account, or another person uses the browser profile.
 */
async function verifyPersistedWallet(state: WalletState): Promise<void> {
  try {
    // Check if Freighter is still connected and this address is allowed
    const [connectedResult, allowedResult] = await Promise.all([
      checkFreighterConnected(),
      isAllowed(),
    ]);

    const isWalletConnected =
      connectedResult.error === undefined && connectedResult.isConnected;
    const isAddressAllowed =
      allowedResult.error === undefined && allowedResult.isAllowed;

    if (!isWalletConnected || !isAddressAllowed) {
      // Wallet is no longer connected/authorized, clear the state
      useWalletStore.setState({
        publicKey: null,
        isConnected: false,
        balances: {},
      });
      return;
    }

    // Get the current address from Freighter to verify it matches the persisted one
    const addressResult = await getAddress();
    if (addressResult.error !== undefined || !addressResult.address) {
      // Can't retrieve current address, clear the state
      useWalletStore.setState({
        publicKey: null,
        isConnected: false,
        balances: {},
      });
      return;
    }

    // Normalize addresses for comparison (case-insensitive)
    const persistedAddress = state.publicKey?.toLowerCase() ?? '';
    const currentAddress = addressResult.address.toLowerCase();

    if (persistedAddress !== currentAddress) {
      // Different address is now connected, clear the old state
      useWalletStore.setState({
        publicKey: null,
        isConnected: false,
        balances: {},
      });
      return;
    }

    // All checks passed, mark as connected with the verified address
    state.isConnected = true;
  } catch {
    // If verification fails for any reason, clear the state to be safe
    useWalletStore.setState({
      publicKey: null,
      isConnected: false,
      balances: {},
    });
  }
}
