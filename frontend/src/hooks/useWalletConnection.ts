"use client";

import { useCallback, useState } from "react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";
import { trackAuthEvent } from "@/lib/analytics";

export interface WalletConnectionState {
  address: string | null;
  shortAddress: string | null;
  isWalletConnected: boolean;
  isWalletDetected: boolean;
  isLoading: boolean;
  error: string | null;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function useWalletConnection() {
  const [state, setState] = useState<WalletConnectionState>({
    address: null,
    shortAddress: null,
    isWalletConnected: false,
    isWalletDetected: false,
    isLoading: true,
    error: null,
  });

  const checkWalletState = useCallback(async () => {
    try {
      const [connectedResult, allowedResult] = await Promise.all([
        isConnected(),
        isAllowed(),
      ]);

      const hasWallet =
        connectedResult.error === undefined && connectedResult.isConnected;
      const hasPermission =
        allowedResult.error === undefined && allowedResult.isAllowed;

      let address: string | null = null;
      if (hasWallet && hasPermission) {
        const addressResult = await getAddress();
        if (addressResult.error === undefined) {
          address = addressResult.address;
        }
      }

      return { hasWallet, hasPermission, address };
    } catch (error) {
      console.error("Failed to read wallet state:", error);
      return { hasWallet: false, hasPermission: false, address: null };
    }
  }, []);

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
