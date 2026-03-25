"use client";

import { Check, Shield } from "lucide-react";

interface VaultHeroProps {
  escrowId: string;
  custodyType: string;
  status: string;
  isSecured: boolean;
}

export function VaultHero({
  escrowId,
  custodyType,
  status,
  isSecured,
}: VaultHeroProps) {
  return (
    <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-10">
      <div>
        <p className="text-xs font-semibold tracking-widest text-gold uppercase mb-2">
          Vault System Active
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-text-primary">
          Escrow #{escrowId}
        </h1>
        <p className="text-3xl md:text-4xl font-light text-text-muted">
          {custodyType}
        </p>
      </div>

      <div className="flex items-center gap-4 bg-card border border-border-default rounded-2xl px-6 py-4">
        <div className="w-14 h-14 rounded-xl bg-gold-muted flex items-center justify-center">
          <Shield className="w-7 h-7 text-gold" />
        </div>
        <div>
          <p className="text-xs font-medium tracking-widest text-text-secondary uppercase">
            Vault Status
          </p>
          <p className="text-xl font-bold text-emerald">{status}</p>
          {isSecured && (
            <div className="flex items-center gap-1.5 mt-1">
              <Check className="w-4 h-4 text-emerald" />
              <span className="text-xs font-medium text-emerald">
                Secured On-Chain
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}