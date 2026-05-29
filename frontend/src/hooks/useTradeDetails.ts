"use client";

import { useCallback, useEffect, useState } from "react";
import { tradesApi } from "@/lib/api/trades";
import type { TradeResponse } from "@/lib/api/types";

interface UseTradeDetailsState {
  trade: TradeResponse | null;
  loading: boolean;
  error: string | null;
}

export interface UseTradeDetailsResult extends UseTradeDetailsState {
  refetch: () => void;
}

export function useTradeDetails(
  token: string | null,
  id: string,
): UseTradeDetailsResult {
  const [state, setState] = useState<UseTradeDetailsState>({
    trade: null,
    loading: true,
    error: null,
  });

  const fetchTrade = useCallback(async () => {
    if (!token) {
      setState({ trade: null, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const trade = await tradesApi.get(token, id);
      setState({ trade, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load trade";
      setState({ trade: null, loading: false, error: message });
    }
  }, [token, id]);

  useEffect(() => {
    void fetchTrade();
  }, [fetchTrade]);

  return { ...state, refetch: fetchTrade };
}
