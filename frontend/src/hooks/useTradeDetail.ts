import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TradeResponse } from "@/lib/api";
import { useAuth } from "./useAuth";

const POLL_INTERVAL_MS = 10_000;
const POLLING_STATUSES = new Set(["FUNDED", "IN_TRANSIT"]);

interface UseTradeDetailResult {
  trade: TradeResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  deposit: () => Promise<{ unsignedXdr: string }>;
  confirmDelivery: () => Promise<{ unsignedXdr: string }>;
  releaseFunds: () => Promise<{ unsignedXdr: string }>;
  raiseDispute: (reason: string, category: string) => Promise<{ unsignedXdr: string }>;
}

export function useTradeDetail(tradeId: string): UseTradeDetailResult {
  const { token, isAuthenticated } = useAuth();
  const [trade, setTrade] = useState<TradeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrade = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
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
      setIsLoading(false);
    }
  }, [token, isAuthenticated, tradeId]);

  useEffect(() => {
    void fetchTrade();
  }, [fetchTrade]);

  useEffect(() => {
    const status = trade?.status?.toUpperCase();
    if (!status || !POLLING_STATUSES.has(status)) return;

    const interval = setInterval(() => {
      void fetchTrade();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [trade?.status, fetchTrade]);

  const requireToken = useCallback(() => {
    if (!token) throw new Error("Not authenticated");
    return token;
  }, [token]);

  const deposit = useCallback(
    async () => api.trades.deposit(requireToken(), tradeId),
    [requireToken, tradeId],
  );

  const confirmDelivery = useCallback(
    async () => api.trades.confirmDelivery(requireToken(), tradeId),
    [requireToken, tradeId],
  );

  const releaseFunds = useCallback(
    async () => api.trades.releaseFunds(requireToken(), tradeId),
    [requireToken, tradeId],
  );

  const raiseDispute = useCallback(
    async (reason: string, category: string) =>
      api.trades.initiateDispute(requireToken(), tradeId, reason, category),
    [requireToken, tradeId],
  );

  return {
    trade,
    isLoading,
    error,
    refetch: fetchTrade,
    deposit,
    confirmDelivery,
    releaseFunds,
    raiseDispute,
  };
}
