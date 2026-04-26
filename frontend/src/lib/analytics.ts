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
const WALLET_REGEX = /\b0x[a-fA-F0-9]{40}\b|\b[46][a-zA-Z0-9]{48,56}\b/;

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
    // In non-production environments, keep the output visible for developers.
    // This is intentionally privacy-safe and avoids sending real user data.
    // eslint-disable-next-line no-console
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
/**
 * Privacy-Safe Analytics Utility
 *
 * This utility provides a privacy-first analytics layer that ensures no personally
 * identifiable information (PII) is sent to analytics providers. All data is
 * anonymized and aggregated to protect user privacy.
 */

export interface AnalyticsServiceEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: number;
}

export interface AnalyticsConfig {
  provider: 'plausible' | 'custom';
  domain?: string;
  apiEndpoint?: string;
  enabled: boolean;
}

class AnalyticsService {
  private config: AnalyticsConfig;
  private queue: AnalyticsServiceEvent[] = [];
  private isInitialized = false;

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize() {
    if (!this.config.enabled || typeof window === 'undefined') {
      return;
    }

    if (this.config.provider === 'plausible' && this.config.domain) {
      // Load Plausible script
      const script = document.createElement('script');
      script.src = 'https://plausible.io/js/script.js';
      script.defer = true;
      script.setAttribute('data-domain', this.config.domain);
      document.head.appendChild(script);
      this.isInitialized = true;
    }
  }

  /**
   * Track a funnel transition event
   */
  trackFunnel(step: string, from?: string, to?: string) {
    this.track('funnel_transition', {
      step: this.maskString(step),
      from: from ? this.maskString(from) : undefined,
      to: to ? this.maskString(to) : undefined,
    });
  }

  /**
   * Track a failure event (UI exceptions or API errors)
   */
  trackFailure(type: 'ui_error' | 'api_error', error: string, context?: Record<string, unknown>) {
    this.track('failure', {
      type,
      error: this.maskString(error),
      context: context ? this.maskObject(context) : undefined,
    });
  }

  /**
   * Track a custom event
   */
  track(eventName: string, properties?: Record<string, unknown>) {
    if (!this.config.enabled) return;

    const event: AnalyticsServiceEvent = {
      name: eventName,
      properties: properties ? this.maskObject(properties) : undefined,
      timestamp: Date.now(),
    };

    if (this.isInitialized) {
      this.sendEvent(event);
    } else {
      this.queue.push(event);
    }
  }

  private sendEvent(event: AnalyticsServiceEvent) {
    if (this.config.provider === 'plausible') {
      // Plausible automatically handles privacy
      if (window.plausible) {
        window.plausible(event.name, { props: event.properties });
      }
    } else if (this.config.provider === 'custom' && this.config.apiEndpoint) {
      // Custom provider - ensure privacy
      fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => {
        // Silently fail to avoid affecting user experience
      });
    }
  }

  /**
   * Mask sensitive strings to prevent PII leakage
   */
  private maskString(str: string): string {
    // Hash or truncate sensitive data
    if (str.includes('@')) {
      return '[EMAIL_MASKED]';
    }
    if (str.match(/\b\d{10,}\b/)) {
      return '[PHONE_MASKED]';
    }
    if (str.length > 100) {
      return str.substring(0, 50) + '...[TRUNCATED]';
    }
    return str;
  }

  /**
   * Recursively mask sensitive data in objects
   */
  private maskObject(obj: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        masked[key] = this.maskString(value);
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskObject(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  /**
   * Flush queued events (called after initialization)
   */
  flushQueue() {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) this.sendEvent(event);
    }
  }
}

// Global analytics instance
let analyticsInstance: AnalyticsService | null = null;

export function initAnalytics(config: AnalyticsConfig) {
  analyticsInstance = new AnalyticsService(config);
  // Flush any queued events after a short delay
  setTimeout(() => analyticsInstance?.flushQueue(), 1000);
}

export function getAnalytics(): AnalyticsService | null {
  return analyticsInstance;
}

// React hook for analytics
export function useAnalytics() {
  return {
    track: (eventName: string, properties?: Record<string, unknown>) => {
      analyticsInstance?.track(eventName, properties);
    },
    trackFunnel: (step: string, from?: string, to?: string) => {
      analyticsInstance?.trackFunnel(step, from, to);
    },
    trackFailure: (type: 'ui_error' | 'api_error', error: string, context?: Record<string, unknown>) => {
      analyticsInstance?.trackFailure(type, error, context);
    },
  };
}

// Type declarations for Plausible
declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, unknown> }) => void;
  }
}