"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";

interface FreighterIdentityState {
  address: string | null;
  shortAddress: string | null;
  isAuthorized: boolean;
  isWalletDetected: boolean;
  isLoading: boolean;
  connectWallet: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function useFreighterIdentity(): FreighterIdentityState {
  const [address, setAddress] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isWalletDetected, setIsWalletDetected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshIdentity = useCallback(async () => {
    setIsLoading(true);

    try {
      const [connectedResult, allowedResult] = await Promise.all([
        isConnected(),
        isAllowed(),
      ]);

      const hasWallet =
        connectedResult.error === undefined && connectedResult.isConnected;
      const hasPermission =
        allowedResult.error === undefined && allowedResult.isAllowed;

      setIsWalletDetected(hasWallet);
      setIsAuthorized(hasWallet && hasPermission);

      if (hasWallet && hasPermission) {
        const addressResult = await getAddress();
        if (addressResult.error === undefined) {
          setAddress(addressResult.address);
        } else {
          setAddress(null);
        }
      } else {
        setAddress(null);
      }
    } catch {
      setAddress(null);
      setIsAuthorized(false);
      setIsWalletDetected(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    setIsLoading(true);

    try {
      const requestResult = await requestAccess();
      if (requestResult.error === undefined) {
        setAddress(requestResult.address);
        setIsAuthorized(true);
        setIsWalletDetected(true);
      } else {
        await refreshIdentity();
      }
    } catch {
      await refreshIdentity();
    } finally {
      setIsLoading(false);
    }
  }, [refreshIdentity]);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  const shortAddress = useMemo(
    () => (address ? shortenAddress(address) : null),
    [address],
  );

  return {
    address,
    shortAddress,
    isAuthorized,
    isWalletDetected,
    isLoading,
    connectWallet,
    refreshIdentity,
  };
}
