import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TradeResponse } from "@/lib/api";
import { useAuth } from "./useAuth";

interface UseTradeDetailResult {
  trade: TradeResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTradeDetail(tradeId: string): UseTradeDetailResult {
  const { token, isAuthenticated } = useAuth();
  const [trade, setTrade] = useState<TradeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrade = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.trades.get(token, tradeId);
      setTrade(data);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load trade";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated, tradeId]);

  useEffect(() => {
    void fetchTrade();
  }, [fetchTrade]);

  return { trade, loading, error, refetch: fetchTrade };
}
