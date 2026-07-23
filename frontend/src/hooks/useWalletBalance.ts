import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "./useAuth";

interface UseWalletBalanceResult {
  balance: string | null;
  asset: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWalletBalance(): UseWalletBalanceResult {
  const { token, isAuthenticated } = useAuth();
  const [balance, setBalance] = useState<string | null>(null);
  const [asset, setAsset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated || !token) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.wallet.getBalance(token);
      setBalance(data.balance);
      setAsset(data.asset);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load wallet balance";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated]);

  useEffect(() => {
    void fetchBalance();
  }, [fetchBalance]);

  return { balance, asset, loading, error, refetch: fetchBalance };
}
