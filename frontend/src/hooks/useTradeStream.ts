"use client";

import { useEffect, useRef, useState } from "react";
import { apiConfig } from "@/lib/api";

export interface TradeStreamEvent {
  trade_id: string;
  status: string;
  event_type: string;
  timestamp: string;
}

interface UseTradeStreamOptions {
  token?: string | null;
  tradeIds: string[];
  onTradeEvent: (event: TradeStreamEvent) => void;
  onFallbackPoll?: () => void;
}

export function useTradeStream({
  token,
  tradeIds,
  onTradeEvent,
  onFallbackPoll,
}: UseTradeStreamOptions) {
  const [connected, setConnected] = useState(false);
  const reconnectAttempt = useRef(0);
  const eventRef = useRef(onTradeEvent);
  const fallbackRef = useRef(onFallbackPoll);
  const tradeIdsKey = tradeIds.join(",");

  useEffect(() => {
    eventRef.current = onTradeEvent;
    fallbackRef.current = onFallbackPoll;
  }, [onFallbackPoll, onTradeEvent]);

  useEffect(() => {
    if (!token || tradeIds.length === 0 || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const connect = () => {
      const url = new URL(`${apiConfig.getBaseUrl()}/events/stream`);
      url.searchParams.set("trade_ids", tradeIdsKey);

      source = new EventSource(url.toString(), { withCredentials: true });
      source.addEventListener("open", () => {
        setConnected(true);
        reconnectAttempt.current = 0;
        if (fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
      });

      source.addEventListener("trade_status", (message) => {
        eventRef.current(JSON.parse((message as MessageEvent).data));
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!fallbackTimer && fallbackRef.current) {
          fallbackTimer = setInterval(() => fallbackRef.current?.(), 15_000);
        }
        if (!closed) {
          const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 30_000);
          reconnectAttempt.current += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      setConnected(false);
    };
  }, [token, tradeIds.length, tradeIdsKey]);

  return { connected };
}
