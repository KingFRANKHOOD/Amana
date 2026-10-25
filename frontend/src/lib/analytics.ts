type AnalyticsPayload = Record<string, unknown>;

type AnalyticsEvent = {
  eventName: string;
  payload?: AnalyticsPayload;
};

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = [
  "email",
  "name",
  "firstName",
  "lastName",
  "address",
  "phone",
  "ip",
  "wallet",
  "token",
  "jwt",
  "session",
];

const EMAIL_REGEX = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
// Ethereum 0x addresses, Stellar G... public keys (56 chars) and M... muxed accounts (69 chars).
const WALLET_REGEX = /\b0x[a-fA-F0-9]{40}\b|\bG[A-Z2-7]{55}\b|\bM[A-Z2-7]{68}\b/;

// ─── Opt-out ──────────────────────────────────────────────────────────────────

const OPT_OUT_KEY = "amana_analytics_opt_out";

/** Returns true when the user has opted out of analytics. */
export function isAnalyticsOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(OPT_OUT_KEY) === "true";
}

/** Persist the user's analytics opt-out preference to localStorage. */
export function setAnalyticsOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  if (optOut) {
    localStorage.setItem(OPT_OUT_KEY, "true");
  } else {
    localStorage.removeItem(OPT_OUT_KEY);
  }
}

// ─── PII scrubbing ─────────────────────────────────────────────────────────── 

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (EMAIL_REGEX.test(value) || IP_REGEX.test(value) || WALLET_REGEX.test(value)) {
      return REDACTED;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }

  if (typeof value === "object") {
    return scrubProperties(value as AnalyticsPayload);
  }

  return REDACTED;
}

export function scrubProperties(payload: AnalyticsPayload): AnalyticsPayload {
  return Object.entries(payload).reduce<AnalyticsPayload>((acc, [key, value]) => {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey))) {
      acc[key] = REDACTED;
    } else {
      acc[key] = scrubValue(value);
    }
    return acc;
  }, {});
}

function getAnalyticsProvider(): "plausible" | "custom" | "noop" {
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  if (provider === "plausible") return "plausible";
  if (provider === "custom") return "custom";
  return "noop";
}

function getAnalyticsEndpoint(): string | undefined {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
}

function sendToPlausible(eventName: string, payload: AnalyticsPayload) {
  if (typeof window === "undefined" || typeof window.plausible !== "function") {
    return;
  }

  window.plausible(eventName, {
    props: scrubProperties(payload),
  });
}

function sendToCustomEndpoint(eventName: string, payload: AnalyticsPayload) {
  const endpoint = getAnalyticsEndpoint();
  if (typeof navigator === "undefined" || typeof endpoint !== "string" || !endpoint) {
    return;
  }

  const payloadString = JSON.stringify({ eventName, payload: scrubProperties(payload), timestamp: new Date().toISOString() });
  const blob = new Blob([payloadString], { type: "application/json" });

  if (!navigator.sendBeacon(endpoint, blob)) {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadString,
      keepalive: true,
    }).catch(() => {
      /* best effort only */
    });
  }
}

function publishEvent(event: AnalyticsEvent): void {
  // Respect user opt-out preference
  if (isAnalyticsOptedOut()) return;

  const payload = event.payload ?? {};
  const provider = getAnalyticsProvider();

  if (provider === "plausible") {
    sendToPlausible(event.eventName, payload);
    return;
  }

  if (provider === "custom") {
    sendToCustomEndpoint(event.eventName, payload);
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug("Analytics event:", event.eventName, scrubProperties(payload));
  }
}

export function trackEvent(eventName: string, payload: AnalyticsPayload = {}): void {
  publishEvent({ eventName, payload });
}

export function trackFunnelStep(step: string, metadata: AnalyticsPayload = {}): void {
  trackEvent("funnel_step", { step, ...metadata });
}

export function trackFailure(errorType: string, metadata: AnalyticsPayload = {}): void {
  const safeMetadata = scrubProperties(metadata);
  trackEvent("ui_failure", { type: errorType, ...safeMetadata });
}

export function trackApiFailure(endpoint: string, status: number, metadata: AnalyticsPayload = {}): void {
  trackEvent("api_failure", {
    endpoint,
    status,
    ...scrubProperties(metadata),
  });
}

export function trackAuthEvent(step: string, status: "started" | "success" | "failed", metadata: AnalyticsPayload = {}): void {
  trackEvent("auth_event", { step, status, ...scrubProperties(metadata) });
}

// ─── Trade lifecycle instrumentation ─────────────────────────────────────────

/**
 * Track a page view. The path should never contain PII — only route segments
 * like "/trades/[id]" (with the real ID stripped) are safe to send.
 */
export function trackPageView(page: string): void {
  trackEvent("page_view", { page });
}

/**
 * Track a step in the trade creation funnel.
 * step: "details" | "negotiation" | "review" | "submitted" | "confirmed"
 */
export function trackTradeCreationStep(
  step: string,
  metadata: AnalyticsPayload = {},
): void {
  trackFunnelStep(`trade_create:${step}`, metadata);
}

/**
 * Track a trade lifecycle transition (status change).
 * No addresses or amounts are included — only the status label.
 */
export function trackTradeStatusChange(
  toStatus: string,
  metadata: AnalyticsPayload = {},
): void {
  trackEvent("trade_status_change", { toStatus, ...metadata });
}

/**
 * Track a dispute lifecycle event.
 * action: "initiated" | "evidence_uploaded" | "resolved"
 */
export function trackDisputeEvent(
  action: string,
  metadata: AnalyticsPayload = {},
): void {
  trackEvent("dispute_event", { action, ...metadata });
}

// Type declarations for Plausible
declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, unknown> }) => void;
  }
}
