"use client";
import { useState } from "react";
import { BentoCard } from "@/components/ui/BentoCard";
import { Shield, Key } from "lucide-react";
import { LegalDisclaimerModal } from "@/components/ui/LegalDisclaimerModal";

interface VaultValueCardProps {
  value: number;
  currency: string;
  isInsured: boolean;
  onReleaseFunds?: () => void;
}

export function VaultValueCard({
  value,
  currency,
  isInsured,
  onReleaseFunds,
}: VaultValueCardProps) {
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const formattedValue = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

  return (
    <BentoCard title="" icon={null} glowVariant="emerald" className="h-full">
      <LegalDisclaimerModal
        isOpen={showDisclaimer}
        onAccept={() => { setShowDisclaimer(false); onReleaseFunds?.(); }}
        onDecline={() => setShowDisclaimer(false)}
        lossRatio={{ buyer: 5000, seller: 5000 }}
        tradeValueCngn={String(value)}
      />
      <div className="flex flex-col w-76 h-[335.13px]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-widest text-text-secondary uppercase">
            Total Vault Value
          </p>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-text-secondary">{currency}</span>
            <span className="text-text-muted">/</span>
            <span className="text-text-muted">FIAT</span>
          </div>
        </div>

        <p className="text-4xl font-bold text-text-primary mb-4">
          {formattedValue}
          <span className="text-text-muted">.00</span>
        </p>

        {isInsured && (
          <div className="bg-emerald-muted rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-emerald" />
              <span className="text-sm font-semibold text-emerald">
                Fully Insured
              </span>
            </div>
            <p className="text-xs text-emerald leading-relaxed">
              Secured with multi-signature cold storage and 24/7 autonomous
              monitoring.
            </p>
          </div>
        )}

        <button
          onClick={() => setShowDisclaimer(true)}
          className="mt-auto w-full flex items-center justify-center gap-2 bg-gold hover:bg-gold-hover text-text-inverse font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          <Key className="w-5 h-5" />
          Release Funds
        </button>
      </div>
    </BentoCard>
  );
}
