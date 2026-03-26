"use client";

import React from "react";
import type { TradeDetail } from "@/types/trade";
import { WalletAddressBadge } from "@/components/ui/WalletAddressBadge";

interface ContractInfoProps {
  trade: TradeDetail;
}

function LossRatioBar({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    pct < 30 ? "bg-emerald" : pct < 60 ? "bg-status-warning" : "bg-status-danger";

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary font-semibold">{value}%</span>
      </div>
      <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ContractInfo({ trade }: ContractInfoProps) {
  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card">
      <h2 className="text-sm font-semibold text-text-secondary tracking-wide uppercase mb-4">
        Contract Details
      </h2>

      {/* Contract meta */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "Contract ID", value: trade.contractId },
          { label: "Incoterms", value: trade.incoterms },
          { label: "Origin Port", value: trade.originPort },
          { label: "Dest. Port", value: trade.destinationPort },
          { label: "ETA", value: trade.eta },
          { label: "Carrier", value: trade.carrier },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs text-text-muted mb-0.5">{label}</p>
            <p className="text-xs font-semibold text-text-primary truncate">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3">
        <div>
          <p className="text-xs text-text-muted mb-1">Buyer Wallet</p>
          <WalletAddressBadge
            address={trade.buyer.walletAddress}
            truncate="middle"
            showCopy
            showExplorer
            className="w-full justify-between"
          />
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Seller Wallet</p>
          <WalletAddressBadge
            address={trade.seller.walletAddress}
            truncate="middle"
            showCopy
            showExplorer
            className="w-full justify-between"
          />
        </div>
      </div>

      {/* Loss Ratios */}
      {trade.lossRatios && trade.lossRatios.length > 0 && (
        <div className="border-t border-border-default pt-4">
          <p className="text-xs font-semibold text-text-muted mb-3 tracking-wide uppercase">
            Loss Ratios
          </p>
          {trade.lossRatios.map((ratio) => (
            <LossRatioBar
              key={ratio.label}
              label={ratio.label}
              value={ratio.value}
            />
          ))}
        </div>
      )}

      {/* Destination map card */}
      <div className="mt-4 rounded-lg overflow-hidden border border-border-default relative">
        <div
          className="h-28 flex items-end p-3"
          style={{
            background:
              "linear-gradient(135deg, #122A1F 0%, #0B2417 40%, #0D3022 100%)",
          }}
        >
          {/* Decorative world outline */}
          <svg
            className="absolute inset-0 w-full h-full opacity-20"
            viewBox="0 0 300 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            <ellipse cx="150" cy="60" rx="140" ry="55" stroke="#34D399" strokeWidth="0.5" />
            <path d="M60 25 Q90 45 80 60 Q70 80 100 90 Q130 100 150 85 Q170 70 200 80 Q230 90 240 70 Q250 50 230 35 Q210 20 180 30 Q150 40 120 25 Q90 15 60 25z" fill="#34D399" opacity="0.08" />
            <path d="M10 55 Q30 48 50 55 Q70 62 80 55" stroke="#34D399" strokeWidth="0.5" />
            <path d="M220 40 Q240 35 260 42 Q280 49 290 45" stroke="#34D399" strokeWidth="0.5" />
          </svg>

          {/* Destination pin */}
          <div className="absolute top-3 right-4">
            <div className="w-6 h-6 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            </div>
          </div>

          <div className="relative z-10">
            <p className="text-xs font-semibold tracking-widest text-gold mb-0.5">
              DESTINATION
            </p>
            <p className="text-sm font-bold text-text-primary">
              {trade.destinationPort}
            </p>
            {trade.etaLabel && (
              <p className="text-xs text-text-secondary mt-0.5">
                ETA: {trade.etaLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
