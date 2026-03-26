"use client";

import React from "react";
import type { TradeDetail } from "@/types/trade";

interface FinancialSummaryProps {
  trade: TradeDetail;
}

function FinancialRow({
  label,
  value,
  highlight,
  dimmed,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-default last:border-0">
      <span
        className={`text-sm ${dimmed ? "text-text-muted" : "text-text-secondary"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm font-semibold ${
          highlight ? "text-status-danger" : "text-text-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function FinancialSummary({ trade }: FinancialSummaryProps) {
  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-secondary tracking-wide uppercase">
          Financial Summary
        </h2>
        <span className="text-xs text-text-muted">
          All amounts in USDC
        </span>
      </div>

      {/* Main escrow amount */}
      <div className="bg-elevated rounded-lg p-4 mb-4 border border-border-default">
        <p className="text-xs text-text-muted mb-1">Vault Amount Locked</p>
        <p className="text-3xl font-bold text-gold">
          {trade.vaultAmountLocked.toLocaleString()}{" "}
          <span className="text-lg font-semibold text-text-muted">USDC</span>
        </p>
      </div>

      {/* Line items */}
      <div>
        <FinancialRow label="Asset Value" value={`${trade.assetValue.toLocaleString()} USDC`} />
        <FinancialRow
          label={`Platform Fee (${trade.platformFeePercent}%)`}
          value={`${trade.platformFee.toLocaleString()} USDC`}
          highlight
        />
        <FinancialRow
          label="Network Gas Est."
          value={`${trade.networkGasEst} ETH`}
          dimmed
        />
      </div>

      {/* Smart contract badge */}
      <div className="mt-4 flex items-start gap-3 bg-emerald-muted rounded-lg p-3 border border-emerald/20">
        <div className="w-8 h-8 rounded-md bg-emerald/10 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-4 h-4 text-emerald"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M8 1L2 4v4c0 3.3 2.5 6.4 6 7 3.5-.6 6-3.7 6-7V4L8 1z" />
            <path d="M5.5 8l2 2L11 5.5" />
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold text-emerald mb-0.5 tracking-wide">
            SMART CONTRACT SECURED
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            Funds are programmatically locked. Release occurs only upon multi-sig
            validation or verified shipment receipt.
          </p>
        </div>
      </div>
    </div>
  );
}
