import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type CreateTradeRequest,
  type CreateTradeResponse,
  type TradeResponse,
} from "@/lib/api";
import { useAuth } from "./useAuth";

const DEBOUNCE_MS = 300;

interface UseTradesParams {
  status?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

interface UseTradesResult {
  trades: TradeResponse[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  createTrade: (data: CreateTradeRequest) => Promise<CreateTradeResponse>;
}

export function useTrades(params: UseTradesParams = {}): UseTradesResult {
  const { token, isAuthenticated } = useAuth();
  const { status, page = 1, limit = 20, sort } = params;

  const [trades, setTrades] = useState<TradeResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await api.trades.list(token, { status, page, limit, sort });
      setTrades(data.items);
      setTotal(data.pagination.total);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load trades";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [token, isAuthenticated, status, page, limit, sort]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void fetchTrades();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [fetchTrades]);

  const createTrade = useCallback(
    async (data: CreateTradeRequest) => {
      if (!token) throw new Error("Not authenticated");
      return api.trades.create(token, data);
    },
    [token],
  );

  return {
    trades,
    total,
    page,
    limit,
    isLoading,
    error,
    refetch: fetchTrades,
    createTrade,
  };
}
