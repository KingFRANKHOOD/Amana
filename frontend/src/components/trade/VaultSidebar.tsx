"use client";

import React from "react";
import type { TradeDetail } from "@/types/trade";

interface VaultSidebarProps {
  trade: TradeDetail;
}

export function VaultSidebar({ trade }: VaultSidebarProps) {
  return (
    <div className="bg-card rounded-xl border border-border-default p-6 shadow-card">
      <p className="text-xs font-semibold tracking-widest text-text-muted mb-1 uppercase">
        Vault Amount Locked
      </p>
      <p className="text-4xl font-bold text-gold mb-4">
        {trade.vaultAmountLocked.toLocaleString()}{" "}
        <span className="text-xl font-semibold text-text-secondary">USDC</span>
      </p>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Asset Value</span>
          <span className="text-text-primary font-medium">
            {trade.assetValue.toLocaleString()} USDC
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">
            Platform Fee ({trade.platformFeePercent}%)
          </span>
          <span className="text-status-danger font-medium">
            {trade.platformFee.toLocaleString()} USDC
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Network Gas Est.</span>
          <span className="text-text-muted font-medium">
            {trade.networkGasEst} ETH
          </span>
        </div>
      </div>

      {/* Smart contract badge */}
      <div className="flex items-start gap-3 bg-emerald-muted rounded-lg p-3 border border-emerald/20">
        <div className="w-7 h-7 rounded-md bg-emerald/10 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-3.5 h-3.5 text-emerald"
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
            Funds are programmatically locked. Release occurs only upon
            multi-sig validation or verified shipment receipt.
          </p>
        </div>
      </div>

      {/* Dispute help */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-default">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-elevated border border-border-default flex items-center justify-center">
            <svg
              className="w-3.5 h-3.5 text-text-secondary"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="8" cy="8" r="7" />
              <path d="M8 7v1M8 11v.5" strokeLinecap="round" />
              <path d="M6.5 5.5C6.5 4.7 7.2 4 8 4s1.5.7 1.5 1.5c0 1-1.5 2-1.5 2" />
            </svg>
          </div>
          <span className="text-xs text-text-secondary">Need Help?</span>
          <span className="text-xs text-text-muted">Dispute Resolution</span>
        </div>
        <button className="text-xs font-semibold text-gold hover:text-gold-hover transition-colors">
          Open Ticket
        </button>
      </div>
    </div>
  );
}
