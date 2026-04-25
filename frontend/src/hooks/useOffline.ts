"use client";

import { useCallback, useEffect, useState } from "react";

export interface UseOfflineReturn {
  isOffline: boolean;
  wasOffline: boolean;
  isOnline: boolean;
  retryOnline: () => Promise<void>;
}

const ONLINE_CHECK_URL = "https://www.google.com/generate_204";
const ONLINE_CHECK_INTERVAL_MS = 5000;

export function useOffline(): UseOfflineReturn {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  const checkOnlineStatus = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(ONLINE_CHECK_URL, {
        method: "HEAD",
        cache: "no-cache",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const online = response.ok || response.status === 0;
      setIsOffline(!online);
      if (!online) {
        setWasOffline(true);
      }
      return online;
    } catch {
      setIsOffline(true);
      setWasOffline(true);
      return false;
    }
  }, []);

  const retryOnline = useCallback(async () => {
    const online = await checkOnlineStatus();
    if (online) {
      setWasOffline(false);
    }
  }, [checkOnlineStatus]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => {
      setIsOffline(true);
      setWasOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(checkOnlineStatus, ONLINE_CHECK_INTERVAL_MS);

    checkOnlineStatus();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [checkOnlineStatus]);

  return {
    isOffline,
    wasOffline,
    isOnline: !isOffline,
    retryOnline,
  };
}