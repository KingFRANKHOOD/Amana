"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
} from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";
import { getStellarHorizonUrl } from "@/lib/api/env";

const BALANCE_REFRESH_INTERVAL_MS = 30_000;

interface UseWalletResult {
  publicKey: string | null;
  network: string | null;
  balances: Record<string, string>;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  refreshBalances: () => Promise<void>;
}

async function fetchBalances(
  publicKey: string,
  horizonUrl: string,
): Promise<Record<string, string>> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(publicKey);

  const balances: Record<string, string> = { XLM: "0" };
  for (const line of account.balances) {
    if (line.asset_type === "native") {
      balances.XLM = line.balance;
    } else if ("asset_code" in line) {
      balances[line.asset_code] = line.balance;
    }
  }
  return balances;
}

export function useWallet(): UseWalletResult {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [walletConnected, setWalletConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshBalances = useCallback(async () => {
    setError(null);

    try {
      const [connectedResult, allowedResult] = await Promise.all([
        isConnected(),
        isAllowed(),
      ]);

      const hasWallet =
        connectedResult.error === undefined && connectedResult.isConnected;
      const hasPermission =
        allowedResult.error === undefined && allowedResult.isAllowed;

      if (!hasWallet || !hasPermission) {
        setWalletConnected(false);
        setPublicKey(null);
        setNetwork(null);
        setBalances({});
        return;
      }

      const [addressResult, networkResult] = await Promise.all([
        getAddress(),
        getNetwork(),
      ]);

      if (addressResult.error !== undefined) {
        throw new Error("Failed to retrieve wallet address");
      }
      if (networkResult.error !== undefined) {
        throw new Error("Failed to retrieve wallet network");
      }

      setPublicKey(addressResult.address);
      setNetwork(networkResult.network);
      setWalletConnected(true);

      const horizonUrl = getStellarHorizonUrl(networkResult.network);
      const fetchedBalances = await fetchBalances(
        addressResult.address,
        horizonUrl,
      );
      setBalances(fetchedBalances);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshBalances();
    }, BALANCE_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshBalances]);

  return {
    publicKey,
    network,
    balances,
    isConnected: walletConnected,
    isConnecting,
    error,
    refreshBalances,
  };
}
