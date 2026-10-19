"use client";

import { useCallback, useState } from "react";
import { requestAccess } from "@stellar/freighter-api";
import { trackAuthEvent } from "@/lib/analytics";
import { readFreighterWalletState, shortenAddress } from "@/lib/freighterWallet";

export interface WalletConnectionState {
  address: string | null;
  shortAddress: string | null;
  isWalletConnected: boolean;
  isWalletDetected: boolean;
  isLoading: boolean;
  error: string | null;
}

export { shortenAddress };

export function useWalletConnection() {
  const [state, setState] = useState<WalletConnectionState>({
    address: null,
    shortAddress: null,
    isWalletConnected: false,
    isWalletDetected: false,
    isLoading: true,
    error: null,
  });

  const checkWalletState = readFreighterWalletState;

  const connectWallet = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      trackAuthEvent("connect_wallet", "started");
      const requestResult = await requestAccess();
      if (requestResult.error !== undefined) {
        throw new Error(requestResult.error.message || "Failed to connect wallet");
      }

      const address = requestResult.address;
      setState((prev) => ({
        ...prev,
        address,
        shortAddress: shortenAddress(address),
        isWalletConnected: true,
        isWalletDetected: true,
        isLoading: false,
      }));
      trackAuthEvent("connect_wallet", "success", { connected: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to connect wallet";
      trackAuthEvent("connect_wallet", "failed", { error: message });
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, []);

  return {
    ...state,
    setState,
    checkWalletState,
    connectWallet,
  };
}
