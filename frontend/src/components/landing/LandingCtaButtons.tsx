"use client";

import Link from "next/link";
import { useAnalytics } from "@/components/AnalyticsProvider";

export function LandingCtaButtons() {
  const { trackEvent } = useAnalytics();

  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
      <Link
        href="/vault"
        onClick={() => trackEvent("landing_cta_clicked", { target: "vault" })}
        className="px-8 py-3 bg-gold text-text-inverse font-semibold rounded-lg hover:bg-gold-hover transition-colors"
      >
        Go to Vault
      </Link>
      <Link
        href="/trades"
        onClick={() => trackEvent("landing_cta_clicked", { target: "trades" })}
        className="px-8 py-3 border border-border-default text-text-primary font-semibold rounded-lg hover:bg-bg-card transition-colors"
      >
        View Trades
      </Link>
    </div>
  );
}
