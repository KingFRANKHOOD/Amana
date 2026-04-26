"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import {
  trackApiFailure,
  trackAuthEvent,
  trackEvent,
  trackFailure,
  trackFunnelStep,
} from "@/lib/analytics";

interface AnalyticsContextValue {
  trackEvent: (eventName: string, payload?: Record<string, unknown>) => void;
  trackFunnelStep: (step: string, metadata?: Record<string, unknown>) => void;
  trackFailure: (errorType: string, metadata?: Record<string, unknown>) => void;
  trackApiFailure: (endpoint: string, status: number, metadata?: Record<string, unknown>) => void;
  trackAuthEvent: (step: string, status: "started" | "success" | "failed", metadata?: Record<string, unknown>) => void;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const trackEventCallback = useCallback(
    (eventName: string, payload: Record<string, unknown> = {}) => {
      trackEvent(eventName, payload);
    },
    []
  );

  const trackFunnel = useCallback(
    (step: string, metadata: Record<string, unknown> = {}) => {
      trackFunnelStep(step, metadata);
    },
    []
  );

  const trackFailureCallback = useCallback(
    (errorType: string, metadata: Record<string, unknown> = {}) => {
      trackFailure(errorType, metadata);
    },
    []
  );

  const trackApiFailureCallback = useCallback(
    (endpoint: string, status: number, metadata: Record<string, unknown> = {}) => {
      trackApiFailure(endpoint, status, metadata);
    },
    []
  );

  const trackAuthEventCallback = useCallback(
    (step: string, status: "started" | "success" | "failed", metadata: Record<string, unknown> = {}) => {
      trackAuthEvent(step, status, metadata);
    },
    []
  );

  const value = useMemo(
    () => ({
      trackEvent: trackEventCallback,
      trackFunnelStep: trackFunnel,
      trackFailure: trackFailureCallback,
      trackApiFailure: trackApiFailureCallback,
      trackAuthEvent: trackAuthEventCallback,
    }),
    [trackEventCallback, trackFailureCallback, trackFunnel, trackApiFailureCallback, trackAuthEventCallback]
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics() {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error("useAnalytics must be used within an AnalyticsProvider");
  }
  return context;
}
